# 2024-2026 Voter Flows

#### You:
put this in plain english for m https://oskanberg.github.io/2026-voter-flows/

#### ChatGPT:
I’ll read the page and turn the main argument into plain English, focusing on what it claims and what the charts mean.

Plain English:

The author is trying to estimate where voters went between the 2024 and 2026 English local elections. Since we only have ward totals, not individual voting histories, this is a statistical guess, not proof. ([Oskan Berg](https://oskanberg.github.io/2026-voter-flows/))

Main claim: Reform’s 2026 gains seem to have come heavily from people who did not vote in 2024, plus some Conservatives. The stronger model estimates about **11% of 2024 non-voters voted Reform in 2026**, and about **16% of 2024 Conservative voters moved to Reform**. Labour losses look much more like **Labour to Green**, not Labour to Reform. ([Oskan Berg](https://oskanberg.github.io/2026-voter-flows/))

The tricky bit is that Reform did not stand in many wards in 2024. So some people who “would have voted Reform” had no Reform candidate. The author adjusts for this by modelling a hidden Reform-supporting group. That improved the model’s fit for Reform a lot. ([Oskan Berg](https://oskanberg.github.io/2026-voter-flows/))

The adjusted model says those hidden Reform voters mostly showed up in 2024 as **non-voters**, not as Conservatives: around **87% were estimated to have not voted**, while only about **3% appeared as Conservative voters**. ([Oskan Berg](https://oskanberg.github.io/2026-voter-flows/))

So the takeaway is:

Reform’s rise in these local elections may have been less about direct party-switching from Labour, and more about pulling previous non-voters into voting. Conservatives also lost voters to Reform, but the biggest suggested movement is non-voters becoming Reform voters.

Caveat: this is based on aggregate ward data, so it cannot prove what individual voters did. The author explicitly says not to draw firm conclusions. ([Oskan Berg](https://oskanberg.github.io/2026-voter-flows/))


#### You:
lol, oskan berg's model is literally what I am trying to validate or disprove, you can't use it as evidence for itself.

#### ChatGPT:
Fair point. I shouldn’t have treated the post as evidence for its own conclusion.

Plain English version, without endorsing it:

Oskar’s model is trying to infer voter movement from ward-level election results. It sees Reform doing well in 2026 and asks: “which 2024 voter groups best explain that?”

His preferred model says Reform’s rise fits best if a lot of its 2026 support came from people recorded as non-voters in 2024, plus some Conservatives, rather than mainly from Labour voters.

The big modelling choice is that Reform often did not stand in 2024, so he adds a “latent Reform” group: people who might have voted Reform if there had been a candidate. Once he adds that, the model says many of those latent Reform voters probably showed up as non-voters in 2024.

The weak point you’re testing is exactly this: whether the model is discovering real voter flows, or whether the assumptions force the “non-voter to Reform” result. To validate or disprove it, you’d want to check things like:

1. Does it predict held-out wards better than simpler models?
2. Is the “latent Reform” group identifiable, or just absorbing error?
3. Does the result survive different priors/constraints?
4. Does it match actual panel/survey data?
5. Does it fail in places where Reform did stand in both elections?
6. Are turnout changes doing too much of the explanatory work?

So the honest summary is: the post argues “Reform’s gains look like mobilisation of prior non-voters more than Labour switching,” but the model itself is the thing under test.


#### You:
i told you exactly what to do... get the per ward turnouts for 2026 and 2023 (moved from 2022? iirc, NOT the general election in 2024) and simply compare them ward by ward, and bucket by who won this time. Simple

#### ChatGPT:
You’re right. The comparison should be 2026 local election turnout against the previous comparable local cycle, likely 2023 where these seats were last fought, grouped by 2026 winner. I’ll use ward-level turnout, not 2024 GE data.I found the repo data path and the preprocessing choice: he is comparing May 2024 to May 2026 and filtering to wards appearing in both, with turnout reported in both. That is the wrong baseline for your proposed test if these wards were last normally contested in 2023.

Yes. The test is:

```text
for each 2026 ward:
  turnout_delta = turnout_2026 - turnout_previous_local_cycle
  bucket by 2026 winning party
```

Oskar’s repo currently loads **2024 and 2026** candidate CSVs, then filters to wards present in both with turnout in both. That is visible in `wards.py`: it explicitly says it loads Democracy Club CSVs for **May 2024 and May 2026**, and `FILES` only contains `candidates_2024.csv` and `candidates_2026.csv`. ([GitHub](https://raw.githubusercontent.com/oskanberg/2026-voter-flows/main/wards.py))

So the quick disproval/validation cut should ignore that baseline and use the previous comparable local contest. The 2023 Commons Library local-election dataset says it includes ward voting turnout, vacancies, candidate party, votes, outcomes, etc. ([House of Commons Library](https://commonslibrary.parliament.uk/2023-local-elections-handbook-and-dataset/?utm_source=chatgpt.com)) For councils last fought all-out in 2022, use 2022 instead.

Minimal pandas shape:

```python
import pandas as pd

prev = pd.read_csv("wards_2023_or_2022.csv")
cur = pd.read_csv("wards_2026.csv")

# expected columns:
# ward_id, ward_name, council, turnout_pct, winner_party

prev = prev.rename(columns={"turnout_pct": "turnout_prev"})
cur = cur.rename(columns={
    "turnout_pct": "turnout_2026",
    "winner_party": "winner_2026",
})

df = cur.merge(
    prev[["ward_id", "turnout_prev"]],
    on="ward_id",
    how="inner",
)

df["turnout_delta_pp"] = df["turnout_2026"] - df["turnout_prev"]

out = (
    df.groupby("winner_2026")
      .agg(
          wards=("ward_id", "count"),
          mean_delta_pp=("turnout_delta_pp", "mean"),
          median_delta_pp=("turnout_delta_pp", "median"),
          mean_2026_turnout=("turnout_2026", "mean"),
          mean_prev_turnout=("turnout_prev", "mean"),
      )
      .sort_values("mean_delta_pp", ascending=False)
)

print(out.round(2))
```

The expected read is simple:

```text
If Reform-won wards show a much bigger turnout rise than Lab/Con/LD/Green-won wards,
that supports the mobilisation story.

If Reform-won wards do not show higher turnout rises,
or turnout falls similarly everywhere,
then “non-voter mobilisation” is doing too much work in the model.
```

I could not produce the national bucket table from Oskar’s repo alone because it does not contain the required 2023/2022 baseline. It contains the wrong comparison for this test.


#### You:
how's this?

#### ChatGPT:
I’ll inspect the columns and compute the ward-by-ward turnout deltas bucketed by 2026 winner, then sanity-check whether the baseline looks like the intended 2023/2022 local cycle rather than 2024 GE.

This is not the ward-level test.

The uploaded CSV is a **national England time series**:

```text
59 rows
columns: year, election, turnout_pct, population_m, registered_electorate_m, voted_m, ...
```

It has no:

```text
ward
council
2026 winner
previous local turnout by ward
2026 turnout by ward
```

So it can’t answer the thing you asked for: “compare turnout ward by ward, bucket by who won this time.”

What you need is shaped more like:

```text
ward_id,council,ward_name,turnout_2026,turnout_prev,winner_2026
```

Then the output is:

```text
winner_2026 | wards | mean turnout delta | median turnout delta
```

This file may be useful for a background chart about registered/non-registered population over time, but it is not evidence for or against Reform-specific turnout mobilisation at ward level.


#### You:
I've told you 5 times to go and get the real source files from democracy club. Turnout per wards is logged there

#### ChatGPT:
I’ll pull the Democracy Club ward candidate/result files directly, find the turnout fields for 2026 and the prior comparable local cycle, then produce the bucket table by 2026 winner.I’m switching to the actual Democracy Club export endpoint, not the blog/model repo. Their own data page says candidate/result CSVs include results and are filterable by election date, and the database covers local/devolved elections since 2016.

You’re right. I should have gone straight to DC exports.

What I verified:

Democracy Club’s export endpoint is:

```text
https://candidates.democracyclub.org.uk/data/export_csv/
```

It supports `election_date`, `election_id`, `ballot_paper_id`, `by_election`, `elected`, `party_id`, etc.

Turnout is in the `results` field group as:

```text
turnout_reported
spoilt_ballots
total_electorate
turnout_percentage
```

and the CSV always includes core fields like:

```text
election_id
ballot_paper_id
election_date
party_name
party_id
post_label
seats_contested
```

So the actual source URLs to use are:

```text
https://candidates.democracyclub.org.uk/data/export_csv/?field_group=results&election_date=2026-05-07&cancelled=False&format=csv

https://candidates.democracyclub.org.uk/data/export_csv/?field_group=results&election_date=2023-05-04&cancelled=False&format=csv

https://candidates.democracyclub.org.uk/data/export_csv/?field_group=results&election_date=2022-05-05&cancelled=False&format=csv
```

The aggregation is then:

```python
cur = dc_2026
prev = pd.concat([dc_2023, dc_2022])

cur_winners = cur[cur.elected == True].copy()

ward_2026 = (
    cur.groupby("ballot_paper_id")
       .agg(
           turnout_2026=("turnout_percentage", "first"),
           post_label=("post_label", "first"),
       )
)

winners_2026 = (
    cur_winners.groupby("ballot_paper_id")
       .agg(winner_2026=("party_name", lambda x: "; ".join(sorted(set(x)))))
)

prev_wards = (
    prev.groupby("ballot_paper_id")
        .agg(turnout_prev=("turnout_percentage", "first"))
)

df = (
    ward_2026
    .join(winners_2026)
    .join(prev_wards, how="inner")
)

df["delta_pp"] = df.turnout_2026 - df.turnout_prev

bucket = (
    df.groupby("winner_2026")
      .agg(
          wards=("delta_pp", "count"),
          mean_delta_pp=("delta_pp", "mean"),
          median_delta_pp=("delta_pp", "median"),
          mean_2026=("turnout_2026", "mean"),
          mean_prev=("turnout_prev", "mean"),
      )
      .sort_values("mean_delta_pp", ascending=False)
)
```

I still haven’t produced the table because the live CSV download is not accessible from this environment, but this is the correct source and the correct test.
