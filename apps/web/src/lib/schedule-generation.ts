type UnknownRecord = Record<string, unknown>;

export function extraFocusDecisionMessage(details?: UnknownRecord) {
  const total = numberValue(details?.total_extra_minutes);
  const requiredGain = numberValue(details?.required_minutes_gained);
  const residualShortfall = numberValue(details?.residual_shortfall_minutes);
  const extraByDay = recordArray(details?.extra_minutes_by_day);
  const approvedCapacityByDay = new Map(
    recordArray(details?.approved_capacity_by_day).map((entry) => [
      stringValue(entry.date),
      numberValue(entry.minutes),
    ]),
  );
  const resultingByDay = new Map(
    recordArray(details?.resulting_focus_by_day).map((entry) => [
      stringValue(entry.date),
      numberValue(entry.minutes),
    ]),
  );
  const protectedWork = recordArray(details?.protected_items ?? details?.protected_work);
  const lines = [
    `This draft needs ${formatMinutes(total)} above your preferred focus limit to protect required academic work.`,
  ];

  if (extraByDay.length) {
    lines.push(
      `Affected dates:\n${extraByDay
        .map((entry) => {
          const date = stringValue(entry.date);
          const extra = numberValue(entry.minutes);
          const resulting = resultingByDay.get(date);
          const approvedCapacity = approvedCapacityByDay.get(date);
          return `• ${formatDate(date)}: +${formatMinutes(extra)}${approvedCapacity ? ` (${formatMinutes(approvedCapacity)} approved capacity)` : resulting ? ` (${formatMinutes(resulting)} total focus)` : ""}`;
        })
        .join("\n")}`,
    );
  }

  if (requiredGain) {
    lines.push(`This protects ${formatMinutes(requiredGain)} of required work.${residualShortfall ? ` ${formatMinutes(residualShortfall)} would still remain unresolved.` : ""}`);
  }

  if (protectedWork.length) {
    lines.push(
      `Deadlines this protects:\n${protectedWork
        .map((entry) => {
          const name = stringValue(entry.name) || "Required academic work";
          const deadline = stringValue(entry.deadline);
          const remaining = numberValue(entry.remaining_minutes);
          return `• ${name}${deadline ? ` — ${formatDate(deadline)}` : ""}${remaining ? ` (${formatMinutes(remaining)} still at risk)` : ""}`;
        })
        .join("\n")}`,
    );
  }

  lines.push("Allow this extra focus time for this draft only?");
  return lines.join("\n\n");
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is UnknownRecord => Boolean(entry) && typeof entry === "object",
      )
    : [];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatDate(value: string) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
