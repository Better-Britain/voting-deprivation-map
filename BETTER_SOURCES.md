Yes. The best open source is **Democracy Club**, but treat it as volunteer/crowd-entered during the count, not an official PA-style feed.

Use:

```text
https://candidates.democracyclub.org.uk/api/next/results/?election_date=2026-05-07&page_size=200
https://candidates.democracyclub.org.uk/api/next/ballots/?election_date=2026-05-07&has_results=true&page_size=200
https://candidates.democracyclub.org.uk/api/next/candidates_elected/?election_date=2026-05-07&page_size=200
```

Their docs list `/results/`, `/ballots/`, and `/candidates_elected/`, with filters including `election_date`, `election_id`, `last_updated`, `page`, and `page_size`. The `Result` object includes the ballot id, source, turnout/spoilt/electorate fields, and `candidate_results` with person, party, votes and elected status. ([Democracy Club Candidates][1])

Caveats: Democracy Club says results are “reported by any member of the public” and explicitly says “use with care”; their candidate/results data is free/open, but the API is rate-limited unauthenticated and the `next` API is unstable. ([Democracy Club Candidates][2])

Minimal pull loop:

```python
import requests

BASE = "https://candidates.democracyclub.org.uk/api/next/results/"

params = {
    "election_date": "2026-05-07",
    "page_size": 200,
}

out = []
url = BASE
while url:
    r = requests.get(url, params=params if url == BASE else None, timeout=30)
    r.raise_for_status()
    data = r.json()
    out.extend(data["results"])
    url = data.get("next")

# flatten ward/candidate rows
rows = []
for result in out:
    ballot = result["ballot"]["ballot_paper_id"]
    source = result.get("source")
    for cr in result.get("candidate_results", []):
        rows.append({
            "ballot_paper_id": ballot,
            "person": cr.get("person"),
            "party": cr.get("party"),
            "votes": cr.get("num_ballots"),
            "elected": cr.get("elected"),
            "source": source,
            "turnout": result.get("num_turnout_reported"),
            "turnout_pct": result.get("turnout_percentage"),
        })
```

For candidate/ward metadata, pull ballots too:

```python
BASE = "https://candidates.democracyclub.org.uk/api/next/ballots/"
params = {
    "election_date": "2026-05-07",
    "page_size": 200,
}
```

That gives you the ward/division label and ballot structure, then join on `ballot_paper_id`.

The **Electoral Commission / Democracy Club voter lookup API** is not the thing you want: its docs say the postcode/address API “does not serve the winners or results of elections that have already happened.” ([developers.democracyclub.org.uk][3])

Other usable sources:

**ElectionMapsUK** has a 2026 page with a ward-level map, and its social posts mention a ward-level results spreadsheet, but I only found the public site/social snippet, not a documented API. It is scrapeable if the page ships embedded data or the Google Sheet link is public. ([electionmapsuk][4])

**Open Council Data UK** is useful for defences/incumbents, ward names and council composition joins, not live open ward results. It has a 2026 elections page and paid real-time/API products; public free downloads are mostly annual councillor/composition CSVs. ([opencouncildata.co.uk][5])

**Council websites** remain the official source for ward declarations. For a scraper, start from Democracy Club ballots, use council/ward names to hit council result pages, and keep the council URL as provenance. Expect inconsistent HTML/PDF/ModernGov/Civica formats.

For “right now”, I’d use Democracy Club as the primary feed, poll by `last_updated`, and mark records as provisional unless their `source` is the council declaration page. Then backfill/correct from council pages over the next day or two.

[1]: https://candidates.democracyclub.org.uk/api/docs/next/endpoints/ "Democracy Club Candidates"
[2]: https://candidates.democracyclub.org.uk/uk_results/ "Democracy Club Candidates"
[3]: https://developers.democracyclub.org.uk/api/v1/ "
            
                API Documentation | Democracy Club Developers
            
        "
[4]: https://electionmaps.uk/le2026 "2026 United Kingdom Local Elections — Election Maps UK"
[5]: https://opencouncildata.co.uk/elections.php "Open Council Data UK: councillors parties compositions api datasets elections & emails"
