"use client";

import { buildSimulationResults } from "@/components/monte-carlo/engine";
import type { DatasetOption, SimulationControls, SimulationResults } from "@/components/monte-carlo/types";

type SimulationWorkerRequest = {
  requestId: number;
  dataset: DatasetOption;
  controls: SimulationControls;
};

type SimulationWorkerResponse = {
  requestId: number;
  results: SimulationResults;
};

self.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  const { requestId, dataset, controls } = event.data;
  const results = buildSimulationResults(dataset, controls);
  const response: SimulationWorkerResponse = { requestId, results };
  self.postMessage(response);
};

export {};
