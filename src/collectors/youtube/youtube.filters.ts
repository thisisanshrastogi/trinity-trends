// youtube.filters.ts

export type FilterCategory =
  | "type"
  | "features"
  | "uploadDate"
  | "duration"
  | "sortBy";

interface FilterDef {
  bytes: number[];
  isTail?: boolean;
}

// Each filter = its filter word bytes. 3-byte filters are marked isTail.
const YT_FILTERS = {
  type: {
    Video: { bytes: [0x10, 0x01] },
    Channel: { bytes: [0x10, 0x02] },
    Playlist: { bytes: [0x10, 0x03] },
    Movie: { bytes: [0x10, 0x04] },
  },
  features: {
    Live: { bytes: [0x40, 0x01] },
    "4K": { bytes: [0x70, 0x01] },
    HD: { bytes: [0x20, 0x01] },
    "Subtitles/CC": { bytes: [0x28, 0x01] },
    "Creative Commons": { bytes: [0x30, 0x01] },
    "360°": { bytes: [0x78, 0x01] },
    VR180: { bytes: [0xd0, 0x01, 0x01], isTail: true },
    "3D": { bytes: [0x38, 0x01] },
    HDR: { bytes: [0xc8, 0x01, 0x01], isTail: true },
    Location: { bytes: [0xb8, 0x01, 0x01], isTail: true },
    Purchased: { bytes: [0x48, 0x01] },
  },
  uploadDate: {
    "Last hour": { bytes: [0x08, 0x01] },
    Today: { bytes: [0x08, 0x02] },
    "This week": { bytes: [0x08, 0x03] },
    "This month": { bytes: [0x08, 0x04] },
    "This year": { bytes: [0x08, 0x05] },
  },
  duration: {
    "Under 4 minutes": { bytes: [0x18, 0x01] },
    "4 - 20 minutes": { bytes: [0x18, 0x03] },
    "Over 20 minutes": { bytes: [0x18, 0x02] },
  },
} as const satisfies Record<string, Record<string, FilterDef>>;

// Derive strongly-typed labels per category from the map above.
export type FilterLabel<C extends keyof typeof YT_FILTERS> =
  keyof (typeof YT_FILTERS)[C];

// Distribute over each category so label is tied to its own category's keys.
export type FilterSelection = {
  [C in keyof typeof YT_FILTERS]: {
    category: C;
    label: FilterLabel<C>;
  };
}[keyof typeof YT_FILTERS];

const HEADER_CONST = 0x12; // 00010010

function toBase64(bytes: number[]): string {
  // Works in both Node and browser without Buffer assumptions.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  return btoa(String.fromCharCode(...bytes));
}

export function encodeSp(selections: FilterSelection[]): {
  sp: string;
  spEncoded: string;
} {
  const chosen: FilterDef[] = selections.map(({ category, label }) => {
    const group = YT_FILTERS[category] as Record<string, FilterDef>;
    const f = group?.[label as string];
    if (!f) throw new Error(`Unknown filter: ${category} / ${String(label)}`);
    return f;
  });

  // Spec: 3-byte tail filter must be last.
  chosen.sort((a, b) => Number(a.isTail ?? false) - Number(b.isTail ?? false));

  const hasTail = chosen.some((f) => f.isTail);
  const count = chosen.length;
  // b7..b1 = counter, b0 = tail toggle -> (count << 1) | tailBit
  const b1 = (count << 1) | (hasTail ? 1 : 0);

  const bytes = [HEADER_CONST, b1, ...chosen.flatMap((f) => f.bytes)];
  const sp = toBase64(bytes);
  return { sp, spEncoded: encodeURIComponent(sp) };
}
