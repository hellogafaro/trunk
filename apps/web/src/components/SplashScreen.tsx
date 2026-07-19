import { Logo } from "./ui/logo";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex size-24 items-center justify-center" aria-label="Trunk splash screen">
        <Logo className="size-8 opacity-10" />
      </div>
    </div>
  );
}
