import { LockKeyhole, LogIn, ServerCog, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GateLiteLogo } from "@/components/GateLiteLogo";
import { useLanguage } from "../i18n";

interface LoginPageProps {
  loading?: boolean;
  error?: string | null;
  onSubmit: (username: string, password: string) => Promise<void>;
}

export function LoginPage({ loading = false, error, onSubmit }: LoginPageProps) {
  const { t } = useLanguage();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit(username.trim(), password);
  };

  return (
    <main className="gate-grid flex min-h-svh items-center justify-center p-4">
      <section className="grid w-full max-w-[25rem] gap-4 rounded-xl border bg-card/90 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <GateLiteLogo alt="" className="size-11" imageClassName="size-11 rounded-xl" />
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight">GateLite</div>
            <div className="text-sm text-muted-foreground">{t("Sign in", "登录")}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 rounded-lg border bg-background/55 px-3 py-2">
            <ServerCog className="size-4 text-primary" />
            <span>{t("Traefik control", "Traefik 控制")}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-background/55 px-3 py-2">
            <ShieldCheck className="size-4 text-primary" />
            <span>{t("Admin session", "管理员会话")}</span>
          </div>
        </div>

        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="gatelite-username">{t("Username", "账号")}</Label>
            <Input id="gatelite-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={loading} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gatelite-password">{t("Password", "密码")}</Label>
            <Input
              id="gatelite-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <Button type="submit" size="lg" disabled={loading || !username.trim() || !password}>
            <LogIn className="size-4" />
            {loading ? t("Signing in...", "正在登录...") : t("Sign in", "登录")}
          </Button>
        </form>
      </section>
    </main>
  );
}
