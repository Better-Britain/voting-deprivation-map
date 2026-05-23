# Voting Behavior Comparison

#### You:
do we know precisely how differently people vote in local elections compared to voting for their MP or even in local election part of a general election vs not a general election?

#### ChatGPT:
I’ll treat this as UK elections, since “MP” points that way. I’ll separate what is measurable from ballots and returns, what needs surveys, and where the precision breaks down.

Assuming UK: **not precisely at the individual voter level**, but enough to give a good empirical answer.

The hard limit is the secret ballot. The marked register can show whether someone voted, but not how they voted; ballot papers are not open to public inspection. So nobody can produce a true voter-by-voter ledger saying “Robert voted Labour for MP and Green for council.” ([ICO](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-for-the-use-of-personal-data-in-political-campaigning-1/use-of-the-electoral-register/?utm_source=chatgpt.com), [Electoral Commission](https://www.electoralcommission.org.uk/guidance-candidates-and-agents-uk-parliamentary-elections-great-britain/after-election/what-happens-paperwork-after-result-announced?utm_source=chatgpt.com))

What we do have is three weaker but useful kinds of evidence: aggregate ward/constituency results, post-election surveys such as the British Election Study, and cases where local and general elections happen on the same day. The same-day cases are especially useful because they let researchers compare two ballots cast under the same national political moment, often by the same people.

The cleanest published example is the combined **2015 general and local elections in England**. Rallings, Thrasher, Borisyuk and Turner found that about **26%** of voters reported splitting their general-election and local-election votes; using a stricter definition, excluding “other/other” cases, it was **25.2%**. By party, their BES-based estimates said **21.2% of Conservative GE voters**, **18.4% of Labour GE voters**, **37.1% of Lib Dem GE voters**, **41.9% of UKIP GE voters**, and **42.2% of Green GE voters** chose a different party locally. ([Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf))

The direction is fairly consistent: the two large parties tend to do better in Westminster ballots, while parties with local strength, independents, Lib Dems and Greens often do better in council ballots. In the 2015 same-day comparison, the Conservative general-election vote was about **111-114% of its local vote**, Labour about **104-105%**, while the Lib Dem general-election vote was only about **75-80% of its local vote**, and the Green general-election vote about **60-62% of its local vote**, depending on council type. ([Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf))

Turnout is the bigger difference. Ordinary local elections in England are usually low-turnout events. In 2025, turnout was **34.3%** for county councils, **35.2%** for unitary councils and **30.8%** for combined authority mayoral elections. The 2024 UK general election turnout was **59.7%**, low by general-election standards but still far above normal local-election participation. ([Electoral Commission](https://www.electoralcommission.org.uk/research-reports-and-data/our-reports-and-data-past-elections-and-referendums/report-may-2025-local-elections-england), [House of Commons Library](https://commonslibrary.parliament.uk/general-election-2024-turnout/))

When locals are held alongside a general election, local turnout jumps toward general-election levels. In 2015, the Electoral Commission recorded **66.4%** UK parliamentary turnout, and in English local government elections there were about **31.5 million** eligible electors and roughly **20 million** votes cast, which is around the low-to-mid 60s rather than the usual one-third range. ([Electoral Commission](https://www.electoralcommission.org.uk/research-reports-and-data/our-reports-and-data-past-elections-and-referendums/report-how-may-2015-elections-were-run), [Electoral Commission](https://www.electoralcommission.org.uk/research-reports-and-data/our-reports-and-data-past-elections-and-referendums/results-and-turnout-2015-uk-general-election))

So the practical answer is:

We know **precisely** how the aggregate vote shares differ by ward, council and constituency.

We know **fairly well** how often people split their tickets when local and general ballots coincide, because surveys can ask both choices and aggregate data can cross-check the pattern.

We do **not** know precisely how each individual changed vote, because the system is designed not to let that be known.

For standalone local elections, the comparison is muddier: the electorate is smaller, older and more politically engaged; local incumbency and candidate familiarity matter more; some parties do not stand everywhere; independents and residents’ groups matter in some areas; and local elections are often used as midterm protest votes. The result is not just a scaled-down general election. It is a lower-turnout, differently composed electorate making a partly different kind of choice.


#### You:
yes uk. I am looking at the recent local election results and want to use them to inform a forecast for the next general election. I've mapped constituencies to wards and adjusted for deprivation and census signals, to sub-ward levels (layered intersections)... now I'm currently using this to say "if everyone voting in the next general election votes the way they did this time, this is who would win, for each constituency, but of course I need to know what the base level of change is for that, either per party or per incumbency, or whatever other patterns we can clearly and confidently use to make this adjustment.

#### ChatGPT:
I’ll ground this in UK evidence rather than treating local votes as a direct proxy. The main issue is separating three effects: who turned out, which parties stood locally, and the systematic local-versus-Westminster split.

Yes, but the “base level of change” should not be a single party multiplier. The defensible version is a **local-to-Westminster translation layer**, estimated from past paired data, with turnout treated separately.

Your current baseline:

> everyone at the next GE votes as they did in the local election

is useful as a lower-level geography scenario, but it is too strong in two ways.

First, the local electorate is smaller and differently composed. Recent ordinary locals in England have been around one-third turnout: 2025 was 34.3% in county elections, 35.2% in unitary elections and 30.8% in combined authority mayorals, while the 2024 general election was 59.7%. So in a constituency with 34% local turnout and 60% GE turnout, about **43% of the GE electorate is not directly observed in the local result**. That is not a rounding error; it is a second electorate. ([Electoral Commission](https://www.electoralcommission.org.uk/research-reports-and-data/our-reports-and-data-past-elections-and-referendums/report-may-2025-local-elections-england), [House of Commons Library](https://commonslibrary.parliament.uk/general-election-2024-turnout/))

Second, even when local and general elections happen on the same day, voters split. In the 2015 simultaneous general/local elections, Rallings, Thrasher, Borisyuk and Turner found around **25% to 26%** of voters split their general and local votes. The survey split rates by GE party were roughly **Con 21%, Lab 18%, LD 37%, UKIP 42%, Green 42%**. So even with the same voters on the same day, the local ballot is not a clean proxy for the Westminster ballot. ([Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf))

The best model shape is:

```text
GE_vote_share[c,p]
  = national_GE_anchor[p]
  + local_strength_residual[c,p]
  - local_election_bias[c,p]
  + turnout_composition_effect[c,p]
  + parliamentary_incumbency_effect[c,p]
  + error[c,p]
```

In practice I would do it in log-ratio space, not raw share space:

```text
log(GE_cp / GE_c_ref)
  = α_p
  + β_p * log(Local_cp / Local_c_ref)
  + θ_p · X_c
  + δ_p * MP_incumbent_cp
  + λ_p * local_incumbency_or_council_strength_cp
  + τ_p * turnout_gap_c
  + region_p
```

Then re-softmax to shares and force the national totals to whatever GE anchor you are using.

For the party-level prior, the only clean same-day English evidence gives this rough local-to-GE direction. In 2015, the median **general-election vote as a percentage of local-election vote** was:

| party        | metro boroughs | districts/unitaries | interpretation                                 |
| ------------ | -------------: | ------------------: | ---------------------------------------------- |
| Conservative |          111.2 |               113.8 | Westminster vote higher than local             |
| Labour       |          104.5 |               104.0 | Westminster vote slightly higher               |
| Lib Dem      |           79.6 |                75.3 | local vote much stronger than Westminster vote |
| Green        |           60.4 |                61.6 | local vote much stronger than Westminster vote |
| UKIP         |          101.4 |               101.2 | about even in 2015                             |

Use these as weak priors, not constants. The Lib Dem and Green discounts are especially context-sensitive: in a Westminster target or held seat, the local-to-GE penalty can be much smaller, or disappear. UKIP is not a clean substitute for Reform, though it is the closest historical analogue in that table. ([Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf))

A better calibration for your current project is probably:

```text
bias_2026_cp = Local2026_cp - GE2024_cp
```

or in log-ratio form:

```text
bias_2026_cp = alr(Local2026_cp) - alr(GE2024_cp)
```

Then model that bias by party using your constituency/sub-ward features:

```text
bias_2026_cp ~ party + region + deprivation + age + education
              + tenure + ethnicity + urban/rural
              + Brexit/2019/2024 political history
              + local_incumbency + candidate_presence
              + turnout
```

For a next-GE forecast, subtract the expected local-election bias from the observed local result, then add the national GE swing/poll anchor. That is more robust than saying “LD local vote × 0.78” or “Lab local vote × 1.04”.

The 2026 PNS/NEV figures are useful as checks, not as Westminster targets. The BBC PNS is explicitly an estimate of what the local-election vote would have been if local elections were held everywhere and principal parties contested everywhere; Curtice, Fisher and English stress that it is based on English local election results and should be read mainly as an indicator of political developments in England. They also note that 2026 has extra uncertainty because Reform and Green baselines are patchier historically. ([Elections Etc](https://electionsetc.com/2026/05/07/understanding-the-local-elections-projected-national-share-pns-in-2026/)) The published 2026 PNS was Reform 26%, Green 18%, Conservative 17%, Labour 17%, Lib Dem 16%, Others 6%, but that is still a local-election construct, not a GE vote-share forecast. ([Electoral Reform Society](https://electoral-reform.org.uk/how-would-each-party-have-done-if-mays-elections-were-across-all-of-britain/))

For turnout, treat the local result as observed votes from one stratum:

```text
GE_votes_cp =
    local_voters_cp_after_ticket_split
  + extra_GE_voters_cp
  - local_only_voters_cp
```

The `extra_GE_voters` part should be inferred from GE history and demographics, not from the local ballot. A constituency with low local turnout but high historic GE turnout needs a larger correction than one where local and GE turnout are already close. This is likely to matter most in urban, younger, renter-heavy, high-deprivation seats, because GE turnout in 2024 also varied sharply by constituency and winning-party type. ([House of Commons Library](https://commonslibrary.parliament.uk/general-election-2024-turnout/))

For incumbency, split it into two terms:

```text
local_personal_vote_or_machine_strength
parliamentary_MP_or_candidate_effect
```

Do not let local incumbency transfer wholesale into Westminster. A popular councillor, residents’ group, independent slate, or council administration can create real local vote that has no obvious GE equivalent. Conversely, a sitting MP or heavily targeted Westminster candidate can add votes that the local election misses. The 2015 split-ticket paper found contextual variables and local party presence mattered, including cases where local Lib Dem strength encouraged voters to choose differently between local and general ballots. ([Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf))

I would implement three outputs rather than one:

```text
A. Raw local projection
   "If local votes transferred directly"

B. Local-adjusted Westminster projection
   raw local result
   - modelled local-election bias
   + turnout composition
   + GE national anchor

C. Uncertainty bands
   simulate α, β, turnout uplift, ticket-split matrix, and national anchor
```

The biggest avoidable modelling error is treating missing local candidates as zero Westminster support. If a party did not stand in a ward, impute a latent local share before aggregation. The Commons Library local datasets are useful here because they include ward results, turnout, vacancies, candidate party affiliation and candidate votes, but the data structure is still candidate-level local election data, not a clean Westminster party preference file. ([House of Commons Library](https://commonslibrary.parliament.uk/2025-local-elections-handbook-and-dataset/))

For your current pipeline, the immediate next step is: backtest this on 2024 GE → 2025/2026 locals where you have ward-to-constituency mappings, learn the local-election residuals by party and geography, then invert those residuals for the next-GE forecast. Use the 2015 same-day split-ticket evidence as a prior/regulariser, not as the main coefficient source.


#### You:
a fundamental premise of democracy is that those who turnout to vote are representative of those who didn't. It obviously isn't perfectly represenative, but we use what we have so... we can take turnout out of it, exept if there is a measurement/proof that those who only turnout for generals vote materially differently than those who turnout for locals (either only, or too).

#### ChatGPT:
I’ll narrow this to the evidence for differential preference among local-only, general-only and both-election voters. The useful quantity is not turnout itself, but whether the added GE electorate has a different party mix after controlling for place.

As a modelling shortcut, you can ignore turnout only under a strong assumption:

```txt
P(vote party p | votes at GE only)
≈ P(vote party p | voted in local)
```

That assumption is not well supported. The evidence does not give you a clean administrative proof, because we cannot link a person’s ballot choices across elections. But survey evidence and same-day election evidence are enough to say the GE-only electorate should not just be treated as a random sample of the local electorate.

The clean decomposition is:

```txt
GE_share_p =
    (LocalTurnout / GETurnout) * GE_pref_among_local_voters_p
  + (1 - LocalTurnout / GETurnout) * GE_pref_among_GE_only_voters_p
```

If local turnout is 34% and GE turnout is 60%, then local voters are only about 57% of the GE electorate. The remaining 43% are the term you are currently implicitly setting equal to the local voters. In that situation, if GE-only voters are only 10 points different for a party, that moves the final constituency share by about 4.3 points. That is materially enough to flip seats. The Electoral Commission’s 2025 local report gives 34.3% county turnout, 35.2% unitary turnout and 30.8% combined authority mayoral turnout; 2024 GE turnout was much higher, so the extra electorate is large. ([Electoral Commission](https://www.electoralcommission.org.uk/research-reports-and-data/our-reports-and-data-past-elections-and-referendums/report-may-2025-local-elections-england))

The strongest direct evidence that “local vote = Westminster vote” fails is the 2015 same-day general/local election. Same national moment, often same polling station, same voter. Even then, about 25% to 26% split their general and local votes. The split rate was around 21% for Conservative GE voters, 18% for Labour, 37% for Lib Dems, 42% for UKIP and 42% for Greens. That is not a turnout-composition artefact; it is people making a different ballot choice for a different tier. ([Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf))

The same paper also gives useful weak priors for local-to-GE party bias. In 2015, general-election vote as a percentage of local-election vote was roughly Con 111 to 114, Lab 104, LD 75 to 80, Green 60 to 62, UKIP about 101, depending on council type. So the two big Westminster parties tended to be understated by local results, while Lib Dems and Greens were overstated. I would use this as a prior only, because current Reform/Green/LD geography and tactical conditions are not the same as 2015. ([Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf), [Elections Centre](https://www.electionscentre.co.uk/wp-content/uploads/2015/12/Split-ticket-voting-at-the-combined-General-and-Local-Elections-in-2015.pdf))

For the exact “GE-only versus local-voter” measurement, the dataset to use is BES, not ward returns. BES Wave 30, fielded May 2025 with N=30,342, includes 2024 GE turnout, 2024 GE vote choice, local-election turnout, local-election vote choice, mayoral turnout, likelihood to vote in a general election, party ID and demographics. That is enough to estimate, by party and voter type, the people who voted locally, people who voted in the GE but not locally, and people who say they would or would not vote in a future GE. ([britishelectionstudy.com](https://www.britishelectionstudy.com/data-object/wave-30-of-the-2014-2026-british-election-study-internet-panel/), [britishelectionstudy.com](https://www.britishelectionstudy.com/data-object/wave-30-of-the-2014-2026-british-election-study-internet-panel/), [britishelectionstudy.com](https://www.britishelectionstudy.com/data-object/wave-30-of-the-2014-2026-british-election-study-internet-panel/))

The demographic evidence also points the same way. UK Parliament POST summarises that younger people, people with fewer qualifications, people from lower socio-economic backgrounds, people born overseas and ethnic minority groups are less likely to vote. BES 2024 shows reported GE turnout rising from 65.4% among 18 to 25s to 88.6% among those aged 66+, and YouGov’s 2024 breakdown shows age was strongly related to party choice: younger voters were more Labour/Green, older voters more Conservative/Reform. So when local elections have much lower turnout, the missing electorate is not plausibly neutral. ([POST](https://post.parliament.uk/election-turnout-why-do-some-people-not-vote/), [britishelectionstudy.com](https://www.britishelectionstudy.com/graph/?id=38404), [YouGov](https://yougov.com/en-gb/articles/49978-how-britain-voted-in-the-2024-general-election))

So I would not take turnout out. I would demote it from a headline driver to a correction term with fat uncertainty.

Use:

```txt
GE_pref_among_local_voters =
    local_vote
  × tier_transfer_matrix
```

Then:

```txt
GE_pref_among_GE_only_voters =
    f(2024_GE_vote, current_poll_anchor, demographics, local_area_type, party_ID, past_nonvoter_flows)
```

For current UK conditions, I would especially avoid assuming GE-only voters are just latent Labour/Conservative voters. BES’s 2025 work on Labour’s lost voters says Reform’s new support included a large non-voter component: 33% of Reform’s new supporters came from 2024 non-voters, while Labour’s losses split into indecision, Lib Dems, Greens and some Reform. That implies the “extra” GE electorate could help Reform in some places, Greens/LD/Lab in others, depending on age, education, housing, deprivation and 2024 party history. ([britishelectionstudy.com](https://www.britishelectionstudy.com/uncategorized/looking-for-labours-lost-voters/))

For your model, the practical version is:

```txt
constituency_party_score =
    local_result_mapped_to_constituency
  - estimated_local_tier_bias
  + estimated_GE_only_voter_bias
  + national_poll_or_VI_anchor
  + constituency_candidate/incumbency term
```

Where `estimated_GE_only_voter_bias` should be small but not zero, maybe shrunk hard toward 2024 GE vote by constituency and your census/deprivation cells.

A decent first cut:

```txt
extra_GE_voters_p =
  0.50 * GE2024_constituency_share_p
+ 0.30 * current_national_or_regional_VI_adjusted_p
+ 0.20 * demographic_cell_prediction_p
```

Then run sensitivity at ±5 and ±10 points for the GE-only electorate by party bloc. If the winner changes only under extreme assumptions, your local projection is robust. If it flips under a 5-point GE-only correction, the seat should not be called from local results alone.
