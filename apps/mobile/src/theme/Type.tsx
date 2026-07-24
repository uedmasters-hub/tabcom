import { Text, type TextProps, type TextStyle } from "react-native";
import { color, type as typeScale, type TypeRole } from "./tokens";

/**
 * ══════════════════════════════════════════════════════════════
 *  TYPOGRAPHY COMPONENTS
 * ══════════════════════════════════════════════════════════════
 *
 *  Screens NEVER set fontSize directly. They pick a semantic role
 *  and the scale is applied for them. This is what makes drift
 *  impossible: there is no way to write "text-[19px]" any more.
 *
 *  Usage:
 *    <PageTitle>Create Account</PageTitle>
 *    <Body>Complete the information below.</Body>
 *    <Label>Communications</Label>
 *    <Caption tone="subtle">2 minutes ago</Caption>
 */

type Tone = "ink" | "muted" | "subtle" | "faint" | "primary" | "white"
  | "success" | "warning" | "danger";

const TONE: Record<Tone, string> = {
  ink: color.ink,
  muted: color.muted,
  subtle: color.subtle,
  faint: color.faint,
  primary: color.primary,
  white: color.white,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
};

interface TypeProps extends Omit<TextProps, "style"> {
  children: React.ReactNode;
  /** Semantic colour. Defaults per role. */
  tone?: Tone;
  /** Centre the text. */
  center?: boolean;
  /** Override weight when a role needs emphasis (rare). */
  weight?: TextStyle["fontWeight"];
  /** Layout-only overrides — margins, flex. Never typography. */
  style?: TextStyle;
}

/** Internal factory — builds a component locked to one type role. */
function make(role: TypeRole, defaultTone: Tone, uppercase = false) {
  return function TypeComponent({
    children, tone, center, weight, style, ...rest
  }: TypeProps) {
    const scale = typeScale[role];
    return (
      <Text
        style={[
          {
            fontSize: scale.fontSize,
            lineHeight: scale.lineHeight,
            fontWeight: weight ?? (scale.fontWeight as TextStyle["fontWeight"]),
            letterSpacing: "letterSpacing" in scale ? scale.letterSpacing : undefined,
            color: TONE[tone ?? defaultTone],
            textAlign: center ? "center" : undefined,
            textTransform: uppercase ? "uppercase" : undefined,
          },
          style,
        ]}
        {...rest}
      >
        {children}
      </Text>
    );
  };
}

/* ═══════ THE ONLY TEXT COMPONENTS IN THE APP ═══════ */

/** Onboarding hero — 36px. Used once. */
export const Hero = make("hero", "ink");

/** Tab screen titles — 32px. Chat, Communities, Contacts, Settings. */
export const ScreenTitle = make("screenTitle", "ink");

/** Push-screen headings — 28px. Every sub-page. */
export const PageTitle = make("pageTitle", "ink");

/** Detail headers, modal titles — 24px. */
export const SectionTitle = make("sectionTitle", "ink");

/** Empty-state and card headlines — 20px. */
export const Headline = make("headline", "ink");

/** List row names — 17px. */
export const ItemTitle = make("itemTitle", "ink");

/** Button and action labels — 16px semibold. */
export const Action = make("action", "ink");

/** Body copy and descriptions — 15px. */
export const Body = make("body", "muted");

/** Timestamps, usernames, sub-text — 13px. */
export const Caption = make("caption", "subtle");

/** Section labels — 12px UPPERCASE with tracking. */
export const Label = make("label", "subtle", true);

/** Badges and unread counts — 11px. */
export const Micro = make("micro", "white", true);
