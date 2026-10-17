import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

// numeric -> string (точність), bigint -> string
pg.types.setTypeParser(1700, (v) => v);

const ROOT = join(__dirname, "..", "..");
export const TEMPLATE_DB = "eo_test_template";

export function adminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL не задано. Запустіть scripts/test-db.sh start");
  return url;
}

function urlForDb(name: string): string {
  const u = new URL(adminUrl());
  u.pathname = "/" + name;
  return u.toString();
}

export async function buildTemplate(): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [TEMPLATE_DB],
    );
    await admin.query(`drop database if exists ${TEMPLATE_DB}`);
    await admin.query(`create database ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  const c = new pg.Client({ connectionString: urlForDb(TEMPLATE_DB) });
  await c.connect();
  try {
    await c.query(readFileSync(join(ROOT, "tests/db/supabase-shim.sql"), "utf8"));
    const dir = join(ROOT, "supabase/migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await c.query(readFileSync(join(dir, f), "utf8"));
    }
  } finally {
    await c.end();
  }
}

export class TestDb {
  private constructor(
    public readonly name: string,
    public readonly pool: pg.Pool,
  ) {}

  static async create(): Promise<TestDb> {
    const name = "eo_t_" + randomUUID().replace(/-/g, "").slice(0, 16);
    const admin = new pg.Client({ connectionString: adminUrl() });
    await admin.connect();
    try {
      await admin.query(`create database ${name} template ${TEMPLATE_DB}`);
    } finally {
      await admin.end();
    }
    const pool = new pg.Pool({ connectionString: urlForDb(name), max: 4 });
    return new TestDb(name, pool);
  }

  async destroy(): Promise<void> {
    await this.pool.end();
    const admin = new pg.Client({ connectionString: adminUrl() });
    await admin.connect();
    try {
      await admin.query(`drop database if exists ${this.name} with (force)`);
    } finally {
      await admin.end();
    }
  }

  /** Як суперкористувач (міграції/фікстури). */
  async sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
    return this.pool.query<T>(text, params);
  }

  private async inRole<T extends pg.QueryResultRow>(
    role: "authenticated" | "service_role" | "anon",
    uid: string | null,
    text: string,
    params: unknown[],
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(uid ? { sub: uid, role } : { role }),
      ]);
      await client.query(`set local role ${role}`);
      const res = await client.query<T>(text, params);
      await client.query("commit");
      return res;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  as<T extends pg.QueryResultRow = pg.QueryResultRow>(uid: string, text: string, params: unknown[] = []) {
    return this.inRole<T>("authenticated", uid, text, params);
  }

  asService<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
    return this.inRole<T>("service_role", null, text, params);
  }

  asAnon<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
    return this.inRole<T>("anon", null, text, params);
  }

  async createAuthUser(email?: string): Promise<string> {
    const r = await this.sql<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`,
      [email ?? `u-${randomUUID()}@example.test`],
    );
    return r.rows[0]!.id;
  }

  async createAdmin(): Promise<string> {
    const uid = await this.createAuthUser();
    await this.asService(`select public.bootstrap_admin($1, 'Адмін')`, [uid]);
    return uid;
  }

  async createApartment(adminUid: string, number: string, surname: string, initialReading?: string): Promise<string> {
    const r = await this.as<{ id: string }>(
      adminUid,
      `select (public.admin_upsert_apartment(null, $1, $2, true, $3::numeric, null, null)).id`,
      [number, surname, initialReading ?? null],
    );
    return r.rows[0]!.id;
  }

  /** Повний шлях реєстрації мешканця: код → перевірка → створення профілю. */
  async registerResident(adminUid: string, apartmentId: string, surname: string): Promise<string> {
    const code = (await this.as<{ code: string }>(adminUid, `select public.admin_generate_registration_code($1) as code`, [apartmentId]))
      .rows[0]!.code;
    const number = (await this.sql<{ apartment_number: string }>(`select apartment_number from apartments where id = $1`, [apartmentId]))
      .rows[0]!.apartment_number;
    const v = await this.asService<{ r: { ok: boolean; apartment_id: string } }>(
      `select public.registration_verify($1, $2, $3) as r`,
      [number, surname, code],
    );
    if (!v.rows[0]!.r.ok) throw new Error("verify failed: " + JSON.stringify(v.rows[0]!.r));
    const uid = await this.createAuthUser();
    await this.asService(`select public.registration_complete($1, $2, $3, $4)`, [uid, apartmentId, surname, code]);
    return uid;
  }

  async openPeriod(adminUid: string, year = 2026, month = 9): Promise<string> {
    const r = await this.as<{ id: string }>(
      adminUid,
      `select (public.admin_create_period($1, $2, now() - interval '1 day', now() + interval '1 day', true)).id`,
      [year, month],
    );
    return r.rows[0]!.id;
  }

  async setTariff(adminUid: string, rate: string, validFrom = "2020-01-01"): Promise<void> {
    await this.as(adminUid, `select public.admin_set_tariff($1::numeric, $2::date, null)`, [rate, validFrom]);
  }

  async submitReading(
    uid: string,
    apartmentId: string,
    periodId: string,
    current: string,
    opts: { deposit?: string; hall?: string; other?: string; previous?: string; reason?: string; ack?: boolean } = {},
  ) {
    const r = await this.as<{ r: { reading: Record<string, string>; payment: Record<string, string>; warnings: string[] } }>(
      uid,
      `select public.submit_meter_reading($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7::numeric, null, $8, $9) as r`,
      [apartmentId, periodId, current, opts.deposit ?? "0", opts.hall ?? "0", opts.other ?? "0", opts.previous ?? null,
       opts.reason ?? null, opts.ack ?? false],
    );
    return r.rows[0]!.r;
  }

  async paymentFor(apartmentId: string, periodId: string) {
    const r = await this.sql(`select * from payments where apartment_id = $1 and billing_period_id = $2`, [apartmentId, periodId]);
    return r.rows[0] as Record<string, string> | undefined;
  }

  receiptJson(apartmentId: string, paymentId: string, name = "receipt.pdf") {
    return JSON.stringify([
      {
        storage_path: `${apartmentId}/${paymentId}/${randomUUID()}.pdf`,
        original_filename: name,
        mime_type: "application/pdf",
        file_size: 12345,
      },
    ]);
  }

  async depositBalance(): Promise<string> {
    const r = await this.sql<{ b: string }>(`select public.deposit_balance_internal()::text as b`);
    return r.rows[0]!.b;
  }
}

export async function expectDbError(p: Promise<unknown>, pattern: RegExp, code?: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    const err = e as { message: string; code?: string };
    if (!pattern.test(err.message)) {
      throw new Error(`Очікувалась помилка ${pattern}, отримано: ${err.message}`);
    }
    if (code && err.code !== code) throw new Error(`Очікувався код ${code}, отримано ${err.code}: ${err.message}`);
    return;
  }
  throw new Error(`Очікувалась помилка ${pattern}, але запит виконався успішно`);
}
