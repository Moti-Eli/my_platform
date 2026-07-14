/**
 * Geometric glyphs drawn with plain Views — the app has no icon library and
 * this shell adds no dependencies. One small, consistent visual language
 * (dots / bars / rings / diamond + tab marks) instead of mixed emoji/unicode.
 */
import { View } from "react-native";

export type GlyphName =
  | "dots"
  | "bars"
  | "rings"
  | "diamond"
  | "home"
  | "chat"
  | "profile"
  | "menu";

interface GlyphProps {
  name: GlyphName;
  color: string;
  size?: number;
}

export function Glyph({ name, color, size = 20 }: GlyphProps) {
  const s = size;

  switch (name) {
    case "dots": {
      const d = s * 0.32;
      const dot = { width: d, height: d, borderRadius: d / 2, backgroundColor: color };
      return (
        <View
          style={{
            width: s,
            height: s,
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignContent: "space-between",
          }}
        >
          <View style={dot} />
          <View style={dot} />
          <View style={dot} />
          <View style={[dot, { opacity: 0.45 }]} />
        </View>
      );
    }
    case "bars": {
      const h = s * 0.18;
      const bar = { height: h, borderRadius: h / 2, backgroundColor: color };
      return (
        <View style={{ width: s, height: s, justifyContent: "space-between", paddingVertical: s * 0.08 }}>
          <View style={[bar, { width: "100%" }]} />
          <View style={[bar, { width: "68%" }]} />
          <View style={[bar, { width: "86%", opacity: 0.45 }]} />
        </View>
      );
    }
    case "rings": {
      const inner = s * 0.3;
      return (
        <View
          style={{
            width: s,
            height: s,
            borderRadius: s / 2,
            borderWidth: s * 0.12,
            borderColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: color }} />
        </View>
      );
    }
    case "diamond": {
      const d = s * 0.66;
      return (
        <View style={{ width: s, height: s, alignItems: "center", justifyContent: "center" }}>
          <View
            style={{
              width: d,
              height: d,
              borderRadius: s * 0.14,
              backgroundColor: color,
              transform: [{ rotate: "45deg" }],
            }}
          />
        </View>
      );
    }
    case "home": {
      return (
        <View style={{ width: s, height: s, alignItems: "center", justifyContent: "center" }}>
          <View
            style={{
              width: s * 0.82,
              height: s * 0.82,
              borderRadius: s * 0.24,
              borderWidth: s * 0.1,
              borderColor: color,
              alignItems: "center",
              justifyContent: "flex-end",
              paddingBottom: s * 0.12,
            }}
          >
            <View style={{ width: s * 0.16, height: s * 0.22, borderRadius: s * 0.08, backgroundColor: color }} />
          </View>
        </View>
      );
    }
    case "chat": {
      const d = s * 0.12;
      return (
        <View
          style={{
            width: s * 0.94,
            height: s * 0.78,
            borderRadius: s * 0.3,
            borderBottomLeftRadius: s * 0.08,
            borderWidth: s * 0.1,
            borderColor: color,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: d * 0.7,
            alignSelf: "center",
          }}
        >
          <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
          <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
        </View>
      );
    }
    case "profile": {
      const head = s * 0.36;
      return (
        <View style={{ width: s, height: s, alignItems: "center", justifyContent: "flex-end", gap: s * 0.08 }}>
          <View style={{ width: head, height: head, borderRadius: head / 2, backgroundColor: color }} />
          <View
            style={{
              width: s * 0.78,
              height: s * 0.34,
              borderTopLeftRadius: s * 0.4,
              borderTopRightRadius: s * 0.4,
              backgroundColor: color,
            }}
          />
        </View>
      );
    }
    case "menu": {
      const h = s * 0.14;
      const bar = { height: h, borderRadius: h / 2, backgroundColor: color };
      return (
        <View style={{ width: s, height: s * 0.72, justifyContent: "space-between" }}>
          <View style={[bar, { width: "100%" }]} />
          <View style={[bar, { width: "72%" }]} />
          <View style={[bar, { width: "100%" }]} />
        </View>
      );
    }
  }
}
