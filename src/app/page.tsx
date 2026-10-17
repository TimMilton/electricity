import { redirect } from "next/navigation";
import { getSession, unauthenticatedRedirect } from "@/lib/auth";

export default async function RootPage() {
  const session = await getSession();
  if (!session) return unauthenticatedRedirect();
  if (!session.profile.is_active) redirect("/auth/inactive");
  redirect(session.isAdmin ? "/admin" : "/home");
}
