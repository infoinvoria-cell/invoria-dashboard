"use client";

import EvaluationChart from "./globe/charts/EvaluationChart";
import type { EvaluationResponse } from "../types";

type Props = {
  payload: EvaluationResponse | null;
  loopReplayTick?: number;
};

export default function Valuation10({ payload, loopReplayTick = 0 }: Props) {
  return <EvaluationChart payload={payload} mode="v10" loopReplayTick={loopReplayTick} />;
}