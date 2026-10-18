import { redirect } from "next/navigation";

// Скидання пароля за посиланням із листа більше немає: код доступу змінює адміністратор.
export default function ResetPasswordPage() {
  redirect("/login");
}
