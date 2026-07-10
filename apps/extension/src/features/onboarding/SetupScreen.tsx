import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Check, Globe, Lock } from "lucide-react";
import { useForm } from "react-hook-form";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Avatar, Button, Input, SectionLabel } from "../../components/ui";
import { cn } from "../../lib/cn";
import { claimUsername } from "../../lib/auth-client";
import { useAppStore } from "../../stores/app.store";
import {
  AVATAR_COLORS,
  useProfileStore,
  type ProfileVisibility,
} from "../../stores/profile.store";
import {
  identitySchema,
  type IdentityFormValues,
  type IdentityValues,
} from "./identity.schema";

/**
 * One screen instead of three (visibility -> identity -> avatar).
 * Every field here was already being collected — this just asks for
 * all of it in a single pass instead of three separate page turns for
 * what's fundamentally one decision ("set up my profile").
 */
export default function SetupScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  const displayName = useProfileStore((state) => state.displayName);
  const username = useProfileStore((state) => state.username);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const visibility = useProfileStore((state) => state.visibility);
  const sessionToken = useProfileStore((state) => state.sessionToken);
  const setIdentity = useProfileStore((state) => state.setIdentity);
  const setAvatarColor = useProfileStore((state) => state.setAvatarColor);
  const setVisibility = useProfileStore((state) => state.setVisibility);
  const completeProfile = useProfileStore((state) => state.completeProfile);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<IdentityFormValues, unknown, IdentityValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      displayName,
      username: username ? `@${username}` : "",
    },
  });

  const previewName = watch("displayName") || displayName || "You";

  const onSubmit = async (values: IdentityValues) => {
    if (!sessionToken) {
      // Shouldn't happen in practice — SetupScreen is only ever
      // reached via a magic-link session that has no username yet
      // (guests get their own dedicated GuestSetupScreen). Bounce back
      // to sign-in rather than silently completing without an account.
      setScreen("signin");
      return;
    }

    const result = await claimUsername(
      sessionToken,
      values.username,
      values.displayName,
      avatarColor
    );

    if (!result.ok) {
      if (result.reason === "taken") {
        setError("username", {
          message: "That username is already taken — try another.",
        });
      } else if (result.reason === "invalid_username") {
        setError("username", {
          message: "That username isn't available — try another.",
        });
      } else {
        setError("username", {
          message: "Your session expired — please sign in again.",
        });
      }
      return;
    }

    setIdentity(values);
    completeProfile();
    setScreen("workspace");
  };

  return (
    <AppShell>
      <form
        className="flex h-full flex-col"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        <ScreenHeader onBack={() => setScreen("signin")} />

        <section className="flex flex-1 flex-col overflow-y-auto px-6">
          <SectionLabel>Set up your profile</SectionLabel>

          <h1 className="mt-3 text-2xl font-bold tracking-tight">
            One quick step and you're in.
          </h1>

          <div className="mt-6 flex justify-center">
            <Avatar name={previewName} color={avatarColor} size="xl" />
          </div>

          <div
            role="radiogroup"
            aria-label="Avatar color"
            className="mt-4 flex flex-wrap justify-center gap-2.5"
          >
            {AVATAR_COLORS.map(({ id, value }) => {
              const isSelected = value === avatarColor;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={id}
                  onClick={() => setAvatarColor(value)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105",
                    isSelected && "ring-2 ring-slate-900 ring-offset-2"
                  )}
                  style={{ backgroundColor: value }}
                >
                  {isSelected && <Check size={13} className="text-white" />}
                </button>
              );
            })}
          </div>

          <div className="mt-6 space-y-4">
            <Input
              label="Display Name"
              placeholder="Ramesh Mandal"
              autoComplete="name"
              autoFocus
              error={errors.displayName?.message}
              {...register("displayName")}
            />

            <Input
              label="Username"
              placeholder="@ramesh"
              autoComplete="off"
              hint="Lowercase letters, numbers and underscores."
              error={errors.username?.message}
              {...register("username")}
            />
          </div>

          <SectionLabel className="mt-6">Who can find you?</SectionLabel>

          <div className="mt-2 flex gap-2">
            {(
              [
                { id: "public" as ProfileVisibility, label: "Public", icon: Globe },
                { id: "private" as ProfileVisibility, label: "Private", icon: Lock },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setVisibility(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition",
                  visibility === id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                )}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {visibility === "private"
              ? "Complete end: invisible and unreachable until you invite someone."
              : "Anyone can find and connect with you. Change anytime in Settings."}
          </p>
        </section>

        <ScreenFooter>
          <Button
            type="submit"
            fullWidth
            disabled={isSubmitting}
            rightIcon={<ArrowRight size={18} />}
          >
            {isSubmitting ? "Claiming your username…" : "Get started"}
          </Button>
        </ScreenFooter>
      </form>
    </AppShell>
  );
}
