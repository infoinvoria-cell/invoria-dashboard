"use client";

import MetricCard, { type MetricCardProps } from "./MetricCard";

type Props = {
  cards: Omit<MetricCardProps, "miniChart">[];
};

export default function MetricCardGrid({ cards }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {cards.map((card) => (
        <MetricCard key={card.title} {...card} />
      ))}
    </div>
  );
}
