"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateSMCSignal, type SMCSignal } from "../../src/analysis/smcSignalEngine";
import type { Candle } from "../../src/analysis/engine";

// SMC scanner: confirmed closed-candle setups only.

const intervals = ["5m", "15m", "1h", "4h"] as const;
const refreshIntervals: Record<(typeof intervals)[number], number> = {
  "5m": 60_000,
  "15m": 120_000,