import { redirect } from "next/navigation";

// Відновлення пароля поштою більше немає: новий код доступу видає адміністратор.
export default function ForgotPasswordPage() {
  redirect("/login");
}
