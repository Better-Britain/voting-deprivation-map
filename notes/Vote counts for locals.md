# Vote counts for locals

#### You:
on vote counts for locals... can you use your back-end to test whether wards that voted reform this time (2026 May local elections) show higher turnouts relative to either their previous Locals or to wards those that didn't vote Reform this time. I.e. is Reform voting voters who didn't previously vote (voters in reform wins are up a little) or not (total vote count in reform pools are flat or relatively close to non-reform winners), and if so by how much.

#### ChatGPT:
Yes, but only if we have ward-level rows with:

```text
ward_id / ward_name
year
party
candidate_votes
total_valid_votes
ballots_cast or turnout_pct
electorate
winner_party
```

For 2026, council pages are already publishing ward-level results with candidate votes and turnout, e.g. Watford, Camden and Sheffield. They are HTML pages, not yet a tidy national dataset. ([www.watford.gov.uk](https://www.watford.gov.uk/elections-voting/2026-ward-election-results?utm_source=chatgpt.com), [Camden Council](https://www.camden.gov.uk/local-election-may-2026-results-belsize-ward?utm_source=chatgpt.com), [Sheffield City Council](https://www.sheffield.gov.uk/your-city-council/elections/local-elections-results-2026?utm_source=chatgpt.com))

The test I’d run is:

```text
For each 2026 ward:
  reform_win = winner_party == Reform
  reform_present = any Reform candidate stood
  turnout_2026 = ballots_cast / electorate
  turnout_delta = turnout_2026 - turnout_previous_local
  votes_delta = ballots_cast_2026 - ballots_cast_previous_local
  valid_votes_delta = total_valid_votes_2026 - total_valid_votes_previous_local
```

Then compare:

```text
A. Reform-winning wards vs non-Reform-winning wards
B. Reform-contested wards vs non-Reform-contested wards
C. Reform vote share vs turnout_delta
D. Reform win indicator vs turnout_delta, controlling for previous turnout
```

The key output would be something like:

```text
Mean turnout delta, Reform wins:        +x.x pp
Mean turnout delta, non-Reform wards:   +y.y pp
Difference:                             +(x-y) pp

Mean ballot-count delta, Reform wins:   +n voters
Mean ballot-count delta, others:        +m voters
Difference:                             +(n-m) voters
```

Then a stronger version:

```text
turnout_delta ~ reform_win + previous_turnout + ward_type + council_fixed_effect
```

That avoids mistaking high-turnout councils for a Reform effect.

The crude JS shape:

```js
function groupStats(rows, pred) {
  const xs = rows.filter(pred);
  const mean = k => xs.reduce((a, r) => a + r[k], 0) / xs.length;
  return {
    n: xs.length,
    mean_turnout_2026: mean("turnout_2026"),
    mean_turnout_delta: mean("turnout_delta"),
    mean_ballots_delta: mean("ballots_delta"),
    mean_valid_votes_delta: mean("valid_votes_delta"),
  };
}

const analysed = wards2026
  .map(r => {
    const prev = previousByWard.get(r.ward_id);
    if (!prev) return null;

    return {
      ...r,
      reform_win: r.winner_party === "Reform UK",
      reform_present: r.parties.includes("Reform UK"),
      turnout_2026: r.ballots_cast / r.electorate,
      turnout_previous: prev.ballots_cast / prev.electorate,
      turnout_delta: (r.ballots_cast / r.electorate) - (prev.ballots_cast / prev.electorate),
      ballots_delta: r.ballots_cast - prev.ballots_cast,
      valid_votes_delta: r.total_valid_votes - prev.total_valid_votes,
    };
  })
  .filter(Boolean);

console.table({
  reform_wins: groupStats(analysed, r => r.reform_win),
  non_reform_wins: groupStats(analysed, r => !r.reform_win),
  reform_present: groupStats(analysed, r => r.reform_present),
  reform_absent: groupStats(analysed, r => !r.reform_present),
});
```

I can’t honestly run the national test from the web scrape alone in this turn: the data are scattered across council result pages, and many pages give turnout but not always electorate/ballots in the same format. If you already have your 2026 and previous-local ward result files, upload them and I can compute the comparison directly.


#### You:
i'm asking you to go get those and find out

#### You:
democracy club has wards and winners

#### You:
you'll need 2026 AND the previous locals (ignoring the locals running on the same election as the generals, to get only low-turnout mid-govt locals for fair comparison)

#### ChatGPT:
Yes, but Democracy Club alone is not enough for the exact turnout test.

It gives candidate rows, wards, parties, winners and votes; its own data page says results are available in CSV/API, but that it currently collects **votes cast for FPTP elections**, not necessarily electorate/ballots-issued turnout data. ([democracyclub.org.uk](https://democracyclub.org.uk/data_apis/data/?utm_source=chatgpt.com))

For your test, there are two defensible versions:

```text
A. Participation test
Need: electorate + ballots cast / turnout
Source: council result pages or Electoral Commission returns
Best answer to: did Reform-winning wards bring out more people?

B. Vote-volume proxy
Need: candidate votes by ward
Source: Democracy Club
Best answer to: did Reform-winning wards have higher total candidate-vote volume than comparable previous locals?
```

One trap: many local wards are multi-member. Summing candidate votes is not the same as counting voters, because one voter may cast 2-3 votes. So the clean Democracy Club-only test should either:

```text
1. restrict to single-member wards; or
2. normalise by seats contested; or
3. use council turnout/ballots-cast data instead of candidate-vote totals.
```

Also, the previous-local comparison has to exclude GE-day locals, as you said. I’d classify these as GE-contaminated:

```text
1997, 2001, 2005, 2010, 2015, 2024
```

And use the most recent prior ordinary local for that ward/council cycle.

The model I’d run:

```text
turnout_or_vote_delta =
  2026 ward total
  - previous ordinary local ward total

compare:
  Reform winner wards
  vs non-Reform winner wards
  vs Reform stood but lost wards
```

With outputs:

```text
mean delta in Reform wins
mean delta in non-Reform wins
difference
median difference
council-fixed-effect difference
single-member-only sensitivity check
```

I can’t honestly give the national result yet from Democracy Club alone, because it risks confusing candidate-vote volume with voter turnout. The next useful scrape is:

```text
Democracy Club:
  2026 ward winners + candidate votes
  previous ordinary local candidate votes

Council/EC returns:
  ward electorate
  ballots cast / turnout
```

Then the answer is a simple grouped comparison. Boundary changes also matter: Elections Centre notes around one in five 2026 wards have new boundaries, so those need either notional previous results or exclusion from the strict like-for-like test. ([electionscentre.uk](https://electionscentre.uk/a-bumper-year-for-local-elections-more-candidates-longer-ballots-and-worsening-gender-representation-in-2026/?utm_source=chatgpt.com))


#### You:
you keep making this much more complicated. You only need to compare this most recent locals' per-ward absolute votes count against previous locals (not general) absolute votes count, then adjust every pool by the average, then look if reform winning wards (this election) show consistent increases, that's a clue those were did not vote. It's not proof, but it's supportive if it's strong, not if it's weak, and actively disagrees if reform winning wards are down overally.

#### ChatGPT:
Yes, that’s much cleaner.

You do not need turnout or electorate for the first-pass signal test.

You only need:

```text
ward
year
total valid votes cast
winner party
```

Then:

```text
delta = votes_2026 - votes_previous_ordinary_local
```

And normalize against the national/local average change:

```text
relative_delta =
  ward_delta - mean_delta_all_wards
```

Then compare:

```text
Reform-winning wards
vs
non-Reform-winning wards
```

If Reform is disproportionately mobilising previous non-voters, you’d expect:

```text
mean relative_delta in Reform wins > 0
```

Preferably materially above zero.

If Reform wards are flat or below average, then the evidence points more toward:

```text
vote switching
rather than
new participation
```

You can make it even cleaner by using percentage change:

```text
pct_delta =
  (votes_2026 - votes_prev) / votes_prev
```

Then normalize:

```text
relative_pct_delta =
  ward_pct_delta - national_mean_pct_delta
```

Very crude sketch:

```js
const rows = wards
  .map(w => {
    const prev = previous.get(w.ward_id);
    if (!prev) return null;

    const delta = w.total_votes - prev.total_votes;
    const pct = delta / prev.total_votes;

    return {
      ward: w.ward,
      reform_win: w.winner === "Reform UK",
      total_votes_2026: w.total_votes,
      total_votes_prev: prev.total_votes,
      delta,
      pct_delta: pct,
    };
  })
  .filter(Boolean);

const meanPct =
  rows.reduce((a, r) => a + r.pct_delta, 0) / rows.length;

for (const r of rows) {
  r.relative_pct_delta = r.pct_delta - meanPct;
}

function mean(xs, key) {
  return xs.reduce((a, x) => a + x[key], 0) / xs.length;
}

const reform = rows.filter(r => r.reform_win);
const non = rows.filter(r => !r.reform_win);

console.log({
  overall_mean_pct_delta: mean(rows, "pct_delta"),
  reform_mean_pct_delta: mean(reform, "pct_delta"),
  nonreform_mean_pct_delta: mean(non, "pct_delta"),

  reform_relative: mean(reform, "relative_pct_delta"),
  nonreform_relative: mean(non, "relative_pct_delta"),
});
```

That gets you the directional answer you actually care about:

```text
Did Reform-winning wards show unusually high total participation
relative to the background change in local-election participation?
```

without needing to solve full turnout reconstruction.


#### You:
so run it

#### ChatGPT:
I can’t run the national pull from here: the raw Democracy Club CSV export endpoint is not fetchable in this environment, and I’m not going to invent results.

The exact test is still this:

```text
For each 2026 ward:
  total_votes_2026 = sum(candidate votes in ward)

Find previous ordinary local for same ward:
  total_votes_prev = sum(candidate votes in ward)

delta = total_votes_2026 - total_votes_prev
pct_delta = delta / total_votes_prev

overall_mean = mean(pct_delta across matched wards)
adjusted_delta = pct_delta - overall_mean

Compare adjusted_delta:
  Reform-winning wards
  vs all other wards
```

Use Democracy Club because it has candidate/result CSVs, covers local elections since 2016, and stores votes cast for FPTP elections. ([Democracy Club](https://democracyclub.org.uk/data_apis/data/?utm_source=chatgpt.com)) The 2026 election group is `local.2026-05-07`. ([Democracy Club Elections](https://elections.democracyclub.org.uk/elections/local.2026-05-07/?utm_source=chatgpt.com))

Endpoint pattern:

```text
https://candidates.democracyclub.org.uk/data/export_csv/?field_group=results&election_id=local.2026-05-07
https://candidates.democracyclub.org.uk/data/export_csv/?field_group=results&election_id=local
```

Core pandas version:

```python
import pandas as pd
import numpy as np

cur = pd.read_csv("dc_2026_results.csv")
hist = pd.read_csv("dc_all_local_results.csv")

# adjust these names after inspecting columns
WARD = "ballot_paper_id"
YEAR = "election_date"
PARTY = "party_name"
VOTES = "votes"
ELECTED = "elected"

def ward_totals(df):
    g = df.groupby(WARD)
    out = g[VOTES].sum().rename("total_votes").to_frame()
    winners = (
        df[df[ELECTED] == True]
        .groupby(WARD)[PARTY]
        .apply(lambda s: ";".join(sorted(set(s))))
        .rename("winner_party")
    )
    return out.join(winners)

cur_w = ward_totals(cur)
cur_w["reform_win"] = cur_w["winner_party"].str.contains("Reform", case=False, na=False)

hist = hist[hist[YEAR] < "2026-05-07"]

# if your historical file includes GE-day locals, exclude them here
ge_day_locals = {"2010-05-06", "2015-05-07"}
hist = hist[~hist[YEAR].isin(ge_day_locals)]

prev_rows = (
    hist.sort_values(YEAR)
    .groupby(WARD)
    .tail(1)
)

prev_w = ward_totals(prev_rows).rename(columns={"total_votes": "prev_votes"})

x = cur_w.join(prev_w[["prev_votes"]], how="inner")
x = x[x["prev_votes"] > 0]

x["delta"] = x["total_votes"] - x["prev_votes"]
x["pct_delta"] = x["delta"] / x["prev_votes"]
x["adjusted_pct_delta"] = x["pct_delta"] - x["pct_delta"].mean()

summary = x.groupby("reform_win").agg(
    wards=("pct_delta", "size"),
    mean_prev_votes=("prev_votes", "mean"),
    mean_2026_votes=("total_votes", "mean"),
    mean_delta=("delta", "mean"),
    mean_pct_delta=("pct_delta", "mean"),
    mean_adjusted_pct_delta=("adjusted_pct_delta", "mean"),
    median_adjusted_pct_delta=("adjusted_pct_delta", "median"),
)

print(summary)
```

Interpretation:

```text
Reform adjusted_pct_delta strongly positive:
  supportive of extra/mobilised voters

near zero:
  weak or no evidence

negative:
  argues against the "new non-voters came out" story
```

Upload the two Democracy Club CSVs and I’ll run the actual comparison directly.
