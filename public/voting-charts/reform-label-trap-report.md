# Where the label is wrong

This is a narrow special report.

It looks for constituencies where the public-facing label still reads as a Liberal Democrat, Green, Tory incumbent, or Labour incumbent / big-name seat, but the ward-level forecast is already overwhelmingly Reform.

Generated from `src/data/next-ge-forecast.json` at `2026-05-23T18:12:04.979Z`.

Filter used: forecast winner = `Reform UK`, current label in `Conservative` / `Labour` / `Liberal Democrats` / `Green Party`, and Reform takes at least `75%` of the weighted ward winner tally.

Matches found: `4`.

## Constituencies

| Constituency | Public-facing story | Current MP | Forecast winner | Reform ward mix | Reform ward tally | Forecast lead |
|---|---|---|---|---:|---:|---:|
| Makerfield | Labour big-name | Josh Simons (Labour) | Reform UK | 100.0% | 8.302 | 3.2% |
| Amber Valley | Labour big-name | Linsey Farnsworth (Labour) | Reform UK | 95.0% | 12.017 | 4.2% |
| Aldridge-Brownhills | Tory incumbent | Wendy Morton (Conservative) | Reform UK | 81.7% | 5.992 | 2.8% |
| Ashton-under-Lyne | Labour big-name | Angela Rayner (Labour) | Reform UK | 75.1% | 6.024 | 1.5% |

## Read

- This is not saying the constituency has no local story left.
- It is saying the ward-level aggregation already behaves like a Reform seat even when the current label still points elsewhere.
- The market risk is assuming the visible incumbent brand is the decisive signal when the ward mix is already telling a different story.

## Notes

- `Reform ward tally` is the weighted sum of ward-level wins inside the constituency forecast.
- `Reform ward mix` is that tally as a share of all weighted ward wins used in the roll-up.
- `Forecast lead` is the gap between the top two model scores, shown as a percentage-point style lead for readability.

