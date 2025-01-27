import { AudioLines, Music2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginWithSpotify } from "@/app/actions";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <a href="#" className="flex flex-col items-center gap-2 font-medium">
            <AudioLines className="size-8 text-white" />
            <span className="sr-only">Tune</span>
          </a>
          <h1 className="text-2xl font-bold">Welcome to Tune</h1>
          <div className="text-center text-sm">
            Create personalized playlists powered by AI. No credit card needed.
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <form action={loginWithSpotify}>
            <Button type="submit" className="w-full ">
              Login with Spotify
            </Button>
          </form>
        </div>
      </div>
      <div className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-[#1DB954]">
        By clicking login, you agree to Spotify's{" "}
        <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
      </div>
    </div>
  );
}
