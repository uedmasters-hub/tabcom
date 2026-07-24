import { useRef, useEffect } from "react";
import {
  View, TextInput, ActivityIndicator,
  type TextInputProps, type TextStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color, radius, size, space, type } from "@/theme";
import { Label, Caption } from "@/theme";

export type FieldStatus = "idle" | "checking" | "valid" | "invalid" | "warning";

export interface FormFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  status?: FieldStatus;
  hint?: string;
  inputStyle?: TextStyle;
  autoFocusOnMount?: boolean;
}

const BORDER: Record<FieldStatus, string> = {
  idle: color.border,
  checking: color.primary,
  valid: color.success,
  invalid: color.danger,
  warning: color.warning,
};

const HINT_TONE: Record<FieldStatus, "muted" | "success" | "danger" | "warning"> = {
  idle: "muted",
  checking: "muted",
  valid: "success",
  invalid: "danger",
  warning: "warning",
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

  return (
    <View style={{ marginBottom: space.xl }}>
      {label ? (
        <Label
          tone={status === "invalid" ? "danger" : "muted"}
          style={{ marginBottom: space.sm }}
        >
          {label}
        </Label>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1.5,
          borderColor: BORDER[status],
          borderRadius: radius.md,
          backgroundColor: color.white,
          paddingHorizontal: space.lg,
          height: size.input,
        }}
      >
        <TextInput
          ref={inputRef}
          placeholderTextColor={color.subtle}
          selectionColor={color.primary}
          style={[
            {
              flex: 1,
              fontSize: type.input.fontSize,
              color: color.ink,
              paddingVertical: 0,
              paddingHorizontal: 0,
            },
            inputStyle,
          ]}
          {...rest}
        />

        {status === "checking" && (
          <ActivityIndicator size={16} color={color.primary} style={{ marginLeft: space.sm }} />
        )}
        {(status === "valid" || status === "invalid") && (
          <View
            style={{
              marginLeft: space.sm,
              width: 22,
              height: 22,
              borderRadius: radius.full,
              backgroundColor: status === "valid" ? color.success : color.danger,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name={status === "valid" ? "checkmark" : "close"}
              size={14}
              color={color.white}
            />
          </View>
        )}
        {status === "warning" && (
          <Ionicons
            name="alert-circle"
            size={size.icon}
            color={color.warning}
            style={{ marginLeft: space.sm }}
          />
        )}
      </View>

      {hint ? (
        <Caption tone={HINT_TONE[status]} style={{ marginTop: space.sm }}>
          {hint}
        </Caption>
      ) : (
        <View style={{ height: 22 }} />
      )}
    </View>
  );
}
