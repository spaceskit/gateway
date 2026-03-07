/**
 * 256-word list for human-readable pairing codes.
 *
 * Format: WORD-WORD-WORD-NNNN
 * Each word encodes 8 bits (256 possibilities).
 * 3 words + 4 digits ≈ 24 + 13 = 37 bits of entropy.
 * Enough for a 10-minute one-time pairing code.
 */
export const PAIRING_WORDLIST: readonly string[] = [
  "ALPHA", "AMBER", "ANCHOR", "ARCTIC", "ATLAS", "AURORA", "AUTUMN", "AZURE",
  "BADGE", "BASIL", "BEACON", "BIRCH", "BLAZE", "BLOOM", "BOLT", "BRAVE",
  "BREEZE", "BRICK", "BRIDGE", "BROOK", "BRUSH", "BURST", "BYWAY", "BYTE",
  "CABIN", "CAIRN", "CANAL", "CEDAR", "CHASE", "CHORD", "CIDER", "CLIFF",
  "CLOUD", "COAST", "COBRA", "CORAL", "CRANE", "CREST", "CROWN", "CRYSTAL",
  "DAGGER", "DAWN", "DELTA", "DEPTH", "DINGO", "DRIFT", "DUNE", "DUSK",
  "EAGLE", "EARTH", "ECHO", "EMBER", "EPOCH", "EQUINOX", "ETHER", "EVOKE",
  "FABLE", "FALCON", "FERN", "FIELD", "FJORD", "FLAME", "FLINT", "FORGE",
  "FROST", "FURY", "FUSION", "GALE", "GARNET", "GATE", "GEYSER", "GHOST",
  "GLACIER", "GLEAM", "GLOBE", "GORGE", "GRAIN", "GRANITE", "GROVE", "GUARD",
  "HARBOR", "HAVEN", "HAWK", "HAZEL", "HEATH", "HELM", "HERON", "HOLLOW",
  "HORIZON", "HUNTER", "HYDRA", "IGLOO", "IMPACT", "INDIGO", "INLET", "IRON",
  "ISLAND", "IVORY", "JADE", "JASPER", "JEWEL", "JUNGLE", "JUPITER", "KARMA",
  "KAYAK", "KELP", "KERNEL", "KITE", "KNIGHT", "KNOLL", "LAKE", "LANCE",
  "LARCH", "LARK", "LAVA", "LEAF", "LEDGE", "LIGHT", "LILY", "LINDEN",
  "LION", "LOTUS", "LUNAR", "LYNX", "MANGO", "MAPLE", "MARSH", "MASON",
  "MEADOW", "MESA", "METAL", "MINT", "MIRROR", "MIST", "MOOSE", "MOSAIC",
  "NOBLE", "NORTH", "NOVA", "OAK", "OASIS", "OCEAN", "OLIVE", "ONYX",
  "OPAL", "ORBIT", "OTTER", "OXIDE", "PALM", "PANDA", "PATCH", "PEAK",
  "PEARL", "PEBBLE", "PINE", "PIXEL", "PLAIN", "PLUME", "POINT", "POLAR",
  "POND", "PRISM", "PULSE", "PYTHON", "QUARTZ", "QUEST", "QUICK", "QUIET",
  "RAVEN", "REALM", "REEF", "RIDGE", "RIVER", "ROBIN", "ROCKET", "RUBY",
  "SAGE", "SAIL", "SALMON", "SAND", "SCOUT", "SEAL", "SHADOW", "SHELL",
  "SHORE", "SIERRA", "SILK", "SILVER", "SLATE", "SOLAR", "SPARK", "SPIRE",
  "SPRUCE", "SQUALL", "STAR", "STEEL", "STONE", "STORM", "STRAND", "STREAM",
  "SUMMIT", "SWIFT", "THORN", "THUNDER", "TIDE", "TIGER", "TIMBER", "TORCH",
  "TOWER", "TRAIL", "TROUT", "TULIP", "TUNDRA", "TURBO", "TWINE", "UNITY",
  "VALE", "VALLEY", "VAPOR", "VAULT", "VELVET", "VENUS", "VERTEX", "VIPER",
  "VISTA", "VIVID", "VORTEX", "WALNUT", "WAVE", "WHEAT", "WILLOW", "WIND",
  "WOLF", "WRAITH", "WREN", "XENON", "YACHT", "YARROW", "YIELD", "ZENITH",
  "ZERO", "ZINC", "ZONE", "ZEPHYR", "ALDER", "ARROW", "ASPEN", "BADGE",
  "BASIN", "BLUFF", "CACHE", "CAPE", "CAVERN", "CHALK", "COMET", "COVE",
] as const;
