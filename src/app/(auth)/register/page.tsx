import { redirect } from "next/navigation";

// Самостійної реєстрації більше немає: код доступу видає адміністратор.
export default function RegisterPage() {
  redirect("/login");
}
