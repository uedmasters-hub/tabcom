import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Button, Input, SectionLabel } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";
import { useProfileStore } from "../../stores/profile.store";
import {
  identitySchema,
  type IdentityFormValues,
  type IdentityValues,
} from "./identity.schema";

export default function IdentityScreen() {
  const setScreen = useAppStore((state) => state.setScreen);
  const displayName = useProfileStore((state) => state.displayName);
  const username = useProfileStore((state) => state.username);
  const setIdentity = useProfileStore((state) => state.setIdentity);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<IdentityFormValues, unknown, IdentityValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      displayName,
      username: username ? `@${username}` : "",
    },
  });

  const onSubmit = (values: IdentityValues) => {
    setIdentity(values);
    setScreen("avatar");
  };

  return (
    <AppShell>
      <form
        className="flex h-full flex-col"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        <ScreenHeader onBack={() => setScreen("visibility")} />

        <section className="flex flex-1 flex-col px-6">
          <SectionLabel>Identity</SectionLabel>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">
            Create your identity
          </h1>

          <p className="mt-4 text-sm leading-7 text-slate-500">
            This information will be visible to people you connect with.
          </p>

          <div className="mt-10 space-y-5">
            <Input
              label="Display Name"
              placeholder="Ramesh Mandal"
              autoComplete="name"
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
        </section>

        <ScreenFooter>
          <Button
            type="submit"
            fullWidth
            disabled={isSubmitting}
            rightIcon={<ArrowRight size={18} />}
          >
            Continue
          </Button>
        </ScreenFooter>
      </form>
    </AppShell>
  );
}
