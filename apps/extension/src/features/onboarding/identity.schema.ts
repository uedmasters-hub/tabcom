import { z } from "zod";

export const identitySchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(40, "Display name must be 40 characters or fewer"),

  username: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, "").toLowerCase())
    .pipe(
      z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(20, "Username must be 20 characters or fewer")
        .regex(
          /^[a-z0-9_]+$/,
          "Only lowercase letters, numbers and underscores"
        )
    ),
});

export type IdentityFormValues = z.input<typeof identitySchema>;
export type IdentityValues = z.output<typeof identitySchema>;
