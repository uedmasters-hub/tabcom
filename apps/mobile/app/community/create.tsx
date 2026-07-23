import { useMemo, useRef, useState } from "react";
import {
  Text, View, TextInput, Pressable, ScrollView, Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing, FadeIn, FadeOut, LinearTransition,
  useAnimatedStyle, useSharedValue, withSequence, withTiming,
} from "react-native-reanimated";

/** Calm, deliberate motion: short fades with a gentle decelerate.
 *  No springs on entrances — content should arrive, not perform. */
const CALM = { duration: 240, easing: Easing.out(Easing.cubic) };
const enter = (delay = 0) =>
  FadeIn.duration(240).delay(delay).easing(Easing.out(Easing.cubic));
import { useAuth } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { Avatar } from "@/components/Avatar";
import { createCommunity, inviteToCommunity } from "@/lib/realtime";
import { generateNameIdeas } from "@/lib/name-ideas";
import { contactLabel } from "@tabcom/shared";

type Phase = "naming" | "expanded";

/**
 * Draft survives leaving and returning to the screen (spec: keyboard
 * dismissal, navigation, or interruptions must never discard progress).
 * Module-scoped on purpose — cheaper than a store slice for a single
 * transient screen, and cleared explicitly on successful creation.
 */
let draft: { name: string; phase: Phase; invited: string[] } | null = null;

/**
 * Community creation — a progressive, assisted flow instead of a form.
 *
 * Phase 1 (naming): a hero "Untitled" title with generated name ideas
 * beneath it. Tapping a chip adopts the name; tapping the title edits
 * it in place (the title IS the input — same typography throughout).
 * Only naming exists at this stage.
 *
 * Phase 2 (expanded): after Done, the keyboard drops and the screen
 * unfolds in sequence — title settles up top, chips reaffirm, then
 * Invite Members grows in (label → search → member rows staggered),
 * and finally Create rises. Editing the title afterwards never resets
 * anything: sections are independent, so invites and search persist.
 *
 * Invites chosen here are queued locally and flushed to the server
 * after `createCommunity` returns the new id, since the invite API
 * needs a communityId that doesn't exist yet.
 */
export default function CreateCommunityScreen() {
  const router = useRouter();
  const me = useAuth((s) => s.user);
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);

  const [name, setName] = useState(draft?.name ?? "");
  const [phase, setPhase] = useState<Phase>(draft?.phase ?? "naming");
  const [ideas, setIdeas] = useState<string[]>(() => generateNameIdeas(5));
  const [ideasKey, setIdeasKey] = useState(0);
  const [invited, setInvited] = useState<Set<string>>(
    () => new Set(draft?.invited ?? [])
  );
  const [memberQuery, setMemberQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const trimmed = name.trim();
  const valid = trimmed.length > 0;
  /** A chip is "selected" only while the title exactly matches it —
   *  editing a chosen suggestion makes the name custom again. */
  const selectedIdea = ideas.find((i) => i === trimmed) ?? null;

  const persistDraft = (next: Partial<{ name: string; phase: Phase; invited: Set<string> }>) => {
    draft = {
      name: next.name ?? name,
      phase: next.phase ?? phase,
      invited: [...(next.invited ?? invited)],
    };
  };

  const setNameAndPersist = (v: string) => {
    setName(v);
    setError(null);
    persistDraft({ name: v });
  };

  const adoptIdea = (idea: string) => {
    // The chosen idea flows into the hero title; no confirmation
    // needed even when replacing a custom name (spec §3).
    setNameAndPersist(idea);
  };

  const refreshIdeas = () => {
    // Replace only the chips — never the whole screen. The key bump
    // re-runs the staggered entrance so new ideas cascade in.
    setIdeas(generateNameIdeas(5, ideas));
    setIdeasKey((k) => k + 1);
  };

  const confirmName = () => {
    if (!valid) return;
    Keyboard.dismiss();
    setPhase("expanded");
    persistDraft({ phase: "expanded" });
  };

  // ── Members ─────────────────────────────────────────────────────────
  const allInvitable = useMemo(
    () =>
      contacts.filter(
        (c) =>
          c.id.startsWith("u-") &&
          c.username !== me?.username &&
          connections[c.username] === "accepted"
      ),
    [contacts, connections, me?.username]
  );

  /** Search is a tool for big rosters, not furniture — it only appears
   *  once there are enough people (>8) for scanning to become work. */
  const showSearch = allInvitable.length > 8;

  const invitable = useMemo(() => {
    const q = showSearch ? memberQuery.trim().toLowerCase() : "";
    return q
      ? allInvitable.filter(
          (c) =>
            contactLabel(c).toLowerCase().includes(q) ||
            c.username.toLowerCase().includes(q)
        )
      : allInvitable;
  }, [allInvitable, memberQuery, showSearch]);

  const allInvited = invitable.length > 0 && invitable.every((c) => invited.has(c.username));

  const toggleInvite = (username: string) => {
    setInvited((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      persistDraft({ invited: next });
      return next;
    });
  };

  // ── Create ──────────────────────────────────────────────────────────
  const createScale = useSharedValue(1);
  const createStyle = useAnimatedStyle(() => ({
    transform: [{ scale: createScale.value }],
  }));

  const handleCreate = async () => {
    if (!valid || creating || created) return;
    setCreating(true);
    setError(null);
    // Gentle compress while working (spec §10).
    createScale.value = withTiming(0.98, CALM);
    const id = await createCommunity(trimmed);
    if (!id) {
      createScale.value = withTiming(1, CALM);
      setCreating(false);
      // Inline guidance + fresh alternatives, never a dialog (spec §11).
      setError("That name couldn't be created right now — try again, or pick another idea.");
      refreshIdeas();
      return;
    }
    for (const username of invited) inviteToCommunity(id, username);
    // Success settle, then navigate only after the confirmation lands.
    setCreated(true);
    createScale.value = withTiming(1, CALM);
    draft = null;
    setTimeout(() => router.replace(`/community/${id}` as any), 650);
  };

  const naming = phase === "naming";

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-1 pb-2">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="pr-1.5 active:opacity-50"
        >
          <Ionicons name="chevron-back" size={26} color="#94a3b8" />
        </Pressable>
        <Text className="text-slate-400 font-semibold text-[20px]">Create community</Text>
      </View>

      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Naming: hero floats in the upper-middle so it sits above
              the keyboard. Expanded: everything stacks from the top. */}
          <Animated.View
            layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
            style={{ flex: naming ? 1 : 0, justifyContent: naming ? "center" : "flex-start" }}
          >
            {/* Hero title — this IS the input. Same typography whether
                resting or editing, so editing feels like touching the
                title itself rather than a form field (spec §3). */}
            <Animated.View entering={enter()} layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}>
              <TextInput
                ref={inputRef}
                value={name}
                onChangeText={setNameAndPersist}
                placeholder="Untitled"
                placeholderTextColor="#aebacc"
                multiline
                textAlign="center"
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={naming ? confirmName : undefined}
                className="text-ink font-bold px-8"
                style={{
                  fontSize: naming ? 46 : 34,
                  lineHeight: naming ? 54 : 42,
                  paddingTop: naming ? 0 : 24,
                  paddingBottom: 4,
                }}
              />
              {error && (
                <Animated.Text
                  entering={enter()}
                  exiting={FadeOut.duration(150)}
                  className="text-red-500 text-[14px] text-center px-10 mt-2"
                >
                  {error}
                </Animated.Text>
              )}
            </Animated.View>
          </Animated.View>

          {/* Name ideas — prepared before the user asks (spec §1–2).
              key bump replays the stagger on refresh only. */}
          <Animated.View
            layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
            className="flex-row flex-wrap justify-center items-center px-5 mt-4"
          >
            {ideas.map((idea, i) => {
              const active = idea === selectedIdea;
              return (
                <Animated.View
                  key={`${ideasKey}-${idea}`}
                  entering={enter(60 + i * 40)}
                  layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
                >
                  <Pressable
                    onPress={() => adoptIdea(idea)}
                    className={`rounded-full px-5 py-3 m-1.5 active:opacity-70 ${
                      active ? "bg-[#101a33]" : "bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-[17px] ${
                        active ? "text-white font-bold" : "text-[#5b7a9d] font-semibold"
                      }`}
                    >
                      {idea}
                    </Text>
                  </Pressable>
                </Animated.View>
              );
            })}
            <Animated.View
              entering={enter(60 + ideas.length * 40)}
              layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
            >
              <Pressable onPress={refreshIdeas} hitSlop={8} className="p-3 m-1 active:opacity-50">
                <Ionicons name="sync" size={24} color="#2563eb" />
              </Pressable>
            </Animated.View>
          </Animated.View>

          {/* Phase 2 — unfolds in sequence after Done (spec §5–6). */}
          {!naming && (
            <View className="px-5">
              <Animated.Text
                entering={enter(80)}
                className="text-[#5b7a9d] text-[19px] font-semibold mt-7 mb-3"
              >
                Invite user
              </Animated.Text>

              {/* Search assembles: icon → field → placeholder (§7).
                  Only rendered for rosters large enough to need it. */}
              {showSearch && (
              <Animated.View
                entering={enter(160)}
                className="flex-row items-center bg-surface rounded-full px-5"
              >
                <Animated.View entering={enter(220)}>
                  <Ionicons name="search" size={20} color="#94a3b8" style={{ marginRight: 10 }} />
                </Animated.View>
                <TextInput
                  value={memberQuery}
                  onChangeText={setMemberQuery}
                  placeholder="Search"
                  placeholderTextColor="#94a3b8"
                  className="flex-1 py-3.5 text-ink text-[16.5px]"
                />
              </Animated.View>
              )}

              {/* Me — always first, already in. */}
              {me && (
                <Animated.View entering={enter(240)}>
                  <MemberRow
                    name={me.displayName || me.username || "You"}
                    color={me.avatarColor || "#2563eb"}
                    presence="online"
                    right={<Text className="text-[#5b7a9d] text-[15px]">Admin</Text>}
                  />
                </Animated.View>
              )}

              {invitable.map((c, i) => {
                const isInvited = invited.has(c.username);
                return (
                  <Animated.View
                    key={c.id}
                    entering={enter(300 + i * 45)}
                    layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
                  >
                    <MemberRow
                      name={contactLabel(c)}
                      color={c.color}
                      presence={c.presence}
                      right={
                        <InviteButton
                          invited={isInvited}
                          onPress={() => toggleInvite(c.username)}
                        />
                      }
                    />
                  </Animated.View>
                );
              })}

              {invitable.length === 0 && (
                <Animated.View entering={enter(300)} className="items-center py-8">
                  <Ionicons name="people-outline" size={40} color="#cbd5e1" />
                  <Text className="text-muted text-[15px] text-center mt-3 leading-6">
                    {showSearch && memberQuery
                      ? "No connections match that search."
                      : "No connections to invite yet — you can invite people any time after creating."}
                  </Text>
                </Animated.View>
              )}

              {allInvited && !memberQuery && (
                <Animated.View entering={enter()} className="items-center pt-4 pb-1">
                  <Text className="text-[#5b7a9d] text-[15px] text-center">
                    {showSearch
                      ? "Everyone's invited 🎉 — search to find more people."
                      : "Everyone's invited 🎉"}
                  </Text>
                </Animated.View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Bottom action — DONE while naming, CREATE once expanded.
            Matures with validity instead of hard-toggling (§10). */}
        <View className="px-5 pb-4 pt-1 bg-background">
          {naming ? (
            <Pressable
              onPress={confirmName}
              disabled={!valid}
              className={`rounded-full py-4.5 items-center py-5 ${
                valid ? "bg-[#101a33] active:opacity-90" : "bg-slate-200"
              }`}
            >
              <Text className={`font-bold text-[17px] tracking-widest ${valid ? "text-white" : "text-slate-400"}`}>
                DONE
              </Text>
            </Pressable>
          ) : (
            <Animated.View style={createStyle} entering={enter(380)}>
              <Pressable
                onPress={handleCreate}
                disabled={!valid || creating || created}
                className={`rounded-full py-5 items-center ${
                  created
                    ? "bg-emerald-600"
                    : valid && !creating
                      ? "bg-[#101a33] active:opacity-90"
                      : "bg-slate-200"
                }`}
              >
                <Text
                  className={`font-bold text-[17px] tracking-widest ${
                    valid || created ? "text-white" : "text-slate-400"
                  }`}
                >
                  {created ? "✓  CREATED" : creating ? "CREATING…" : "CREATE"}
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MemberRow({
  name, color, presence, right,
}: {
  name: string;
  color: string;
  presence?: string;
  right: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center pt-4">
      <View className="mr-4">
        <Avatar name={name} color={color} size="md" presence={presence} />
      </View>
      <View className="flex-1 flex-row items-center border-b border-slate-100 pb-4">
        <Text className="flex-1 text-ink font-semibold text-[18px]" numberOfLines={1}>
          {name}
        </Text>
        {right}
      </View>
    </View>
  );
}

/** Add ⇄ invited toggle. Press compresses briefly, then the button
 *  morphs into its invited state (spec §8). */
function InviteButton({ invited, onPress }: { invited: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const press = () => {
    scale.value = withSequence(
      withTiming(0.94, { duration: 80 }),
      withTiming(1, CALM)
    );
    onPress();
  };

  return (
    <Animated.View style={style}>
      {invited ? (
        <Pressable
          onPress={press}
          hitSlop={6}
          className="w-11 h-11 rounded-full bg-rose-50 items-center justify-center active:opacity-70"
        >
          <Ionicons name="person-remove-outline" size={19} color="#f43f5e" />
        </Pressable>
      ) : (
        <Pressable
          onPress={press}
          hitSlop={6}
          className="bg-surface rounded-xl px-4 py-2.5 active:opacity-70"
        >
          <Text className="text-ink font-bold text-[13px] tracking-wide">+ ADD</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
