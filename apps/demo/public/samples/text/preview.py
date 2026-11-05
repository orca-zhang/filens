"""Summarize fictional field-station measurements."""
from dataclasses import dataclass
from statistics import mean
from collections import defaultdict


@dataclass(frozen=True)
class Observation:
    station: str
    temperature: float
    humidity: int


def summarize(rows: list[Observation]) -> dict[str, dict[str, float]]:
    groups: dict[str, list[Observation]] = defaultdict(list)
    for row in rows:
        if 0 <= row.humidity <= 100:
            groups[row.station].append(row)
    return {
        station: {
            "temperature": round(mean(r.temperature for r in group), 1),
            "humidity": round(mean(r.humidity for r in group), 1),
        }
        for station, group in sorted(groups.items())
    }


if __name__ == "__main__":
    observations = [
        Observation("青岚", 17.5, 72),
        Observation("青岚", 19.0, 65),
        Observation("河口", 20.2, 78),
    ]
    for name, values in summarize(observations).items():
        print(name, values)
