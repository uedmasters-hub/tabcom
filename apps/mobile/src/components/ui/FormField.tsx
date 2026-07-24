import { useRef, useEffect } from "react";
import {
  Text,
  View,
  TextInput,
  ActivityIndicator,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const COLOR = {
  ink: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  primary: "#2563eb",
  success: "#16a34a",
  danger: "#dc2626",
  warning: "#d97706",
  placeholder: "#94a3b8",
  white: "#ffffff",
} as const;

export type FieldStatus =
  | "idle" | "checking" | "valid" | "invalid" | "warning";

export interface FormFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  status?: FieldStatus;
  hint?: string;
  inputStyle?: TextStyle;
  autoFocusOnMount?: boolean;
}

const BORDER: Record<FieldStatus, string> = {
  idle: COLOR.border, checking: COLOR.primary, valid: COLOR.success,
  invalid: COLOR.danger, warning: COLOR.warning,
};
const HINT_COLOR: Record<FieldStatus, string> = {
  idle: COLOR.muted, checking: COLOR.muted, valid: COLOR.success,
  invalid: COLOR.danger, warning: COLOR.warning,
};

export function FormField({
  label, status = "idle", hint, inputStyle, autoFocusOnMount, ...rest
}: FormFieldProps) {
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (autoFocusOnMount) {
      const t = setTimeout(() => inputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [autoFocusOnMount]);

  const borderColor = BORDER[status];
  const labelColor = status === "invalid" ? COLOR.danger : COLOR.muted;

  return (
    <View className="mb-5">
      {label ? (
        <Text
          style={{ color: labelColor, fontSize: 13, letterSpacing: 0.1 }}
          className="font-medium mb-1.5"
        >{label}</Text>
      ) : null}
      <View
        style={{ borderColor, borderWidth: 1.5 }}
        className="flex-row items-center rounded-xl bg-white px-4 h-[52px]"
      >
        <TextInput
          ref={inputRef}
          placeholderTextColor={COLOR.placeholder}
          selectionColor={COLOR.primary}
          className="flex-1 text-[16px] text-ink"
          style={[{ paddingVertical: 0, paddingHorizontal: 0 }, inputStyle]}
          {...rest}
        />
        {status === "checking" && (
          <View className="ml-2.5">
            <ActivityIndicator size={16} color={COLOR.primary} />
          </View>
        )}
        {status === "valid" && (
          <View style={{ backgroundColor: COLOR.success }}
            className="ml-2.5 w-[22px] h-[22px] rounded-full items-center justify-center">
            <Ionicons name="checkmark" size={14} color={COLOR.white} />
          </View>
        )}
        {status === "invalid" && (
          <View style={{ backgroundColor: COLOR.danger }}
            className="ml-2.5 w-[22px] h-[22px] rounded-full items-center justify-center">
            <Ionicons name="close" size={14} color={COLOR.white} />
          </View>
        )}
        {status === "warning" && (
          <View className="ml-2.5">
            <Ionicons name="alert-circle" size={20} color={COLOR.warning} />
          </View>
        )}
      </View>
      {hint ? (
        <Text style={{ color: HINT_COLOR[status] }}
          className="text-xs leading-4 mt-1.5 pl-0.5">{hint}</Text>
      ) : (
        <View className="h-[22px]" />
      )}
    </View>
  );
}
