# Elevance Grow

Prospecting for Elevance Labs: find the businesses worth talking to in a neglected industry, with evidence, and prepare the first conversation. React + Vite front end, Supabase back end, deployed to GitHub Pages. The research is done by **Claude Code on a computer of ours**, not by an API key.

It is the fourth app of the suite, beside Work, Support and People. This is its first part (prospecting). The content calendar and product ideas come next.

## How it works

You name a **market**: an industry and a region. From there each step is a button, done by the agent, and waits for you to decide:

| Step | The agent | You |
| --- | --- | --- |
| **Thesis** | Researches the industry on the live web and proposes a brief, with the pages it read | Accept, change or reject it |
| **Sources** | Finds where lists of these businesses can be read, and what each site's terms say | Tick the ones to use |
| **Collector** | Writes a small script that reads one source | An admin reads it and approves it |
| **Dataset** | Nothing: the approved script runs with no model, and the rows are cleaned by plain code | Accept or reject each collected business |
| **Research** | Reads one business's own site and public listings, saves each fact with its page and the words, scores the fit and gives the reason to talk | Qualify it or park it |
| **Draft** | Writes an email, a LinkedIn message or a call script from that reason and the playbook | Edit, copy it out, send it yourself, mark it sent |
| **Next step** | Reads a reply or call notes you paste and suggests what to do | Accept or not |
| **Lessons** | Reads your decisions and their reasons and suggests what to do differently | Accept the ones that are true |

Three rules run through all of it:

- **The agent proposes, a person decides.** Nothing the agent writes changes the record until someone accepts it, and nothing is ever sent from the app.
- **Every fact carries its evidence.** A fact is stored with the page it was read on and the exact words. After the agent saves one, the **worker itself opens the page and looks for those words**; a fact whose words are not there is dropped. What you see is marked *Checked*, *Not checked* (the worker could not read the page: open it before relying on it) or *Inferred* (the agent's conclusion, not something it saw written).
- **Scripts collect, the model judges.** Pulling a list from a register is a script: the same result every time, no model, nothing made up. Reading one business's site and judging the fit is the model's work.

The **playbook** (who we are, what we sell, proof, voice, what never to say) is read by the agent before every job. A draft may quote proof only from there.

## Access model

| Role | Can do |
| --- | --- |
| Admin | Everything below, plus people and their roles, workers, and **approving collectors** (which lets a script run on the worker) |
| Growth | Markets, runs, proposals, the dataset, accounts, drafts, the pipeline, the playbook. Sees collectors but cannot approve them |
| Member | Signs in; there is nothing for them yet (product ideas will be theirs) |
| Agency | Signs in with an email and password; nothing yet (the content calendar will be theirs) |
| Worker | Not a person: a computer's own login. It cannot open the app or read any table. It can take a job and hand back findings for that job, and nothing else |

Staff sign in with Google on `@elevancelabs.com`. Anyone else (the agency, a worker) has a **password login** that an admin sets under **Settings**. A user gets in only if a profile with their email exists, is active, and matches how they signed in. All of this is enforced in the database (row level security and functions), not in the page.

## The pages

- **Today**: what is waiting for a decision: proposals, collectors to approve, collected businesses to review, researched accounts to qualify or park, drafts ready to send, accounts gone quiet, and anything running.
- **Markets**: one per industry and region. A market has four tabs: *Thesis* (with what we have learned there), *Sources*, *Dataset* and *Runs*.
- **Account**: one business: the reason to talk and the fit, everything known with its evidence, people, drafts, details and the timeline. Paste a reply or call notes into the timeline and the agent suggests the next step.
- **Pipeline**: accepted accounts by stage (researching, qualified, contacted, talking, proposal; won, lost and parked fold away). Losing or parking an account asks why: those reasons are what lessons are drawn from.
- **Playbook**: the six sections the agent is grounded in, and the lessons that hold in every market.
- **Sources**: the collector library: each script, the only hosts it may call, a sample of what it returned, and its code.
- **Runs**: everything the agent was asked to do, its steps as they happened, and the tokens it used.
- **Settings** (admins): people, and workers with whether each is online.

## Set up Supabase (once)

Use a project in the account that holds People, not the shared one: this app is the founder's.

1. **Create a project** at supabase.com.
2. **Apply the schema.** With the Supabase CLI:
   ```sh
   supabase link --project-ref <project-ref>
   supabase db push
   ```
   Or paste [`supabase/schema.sql`](supabase/schema.sql) into the SQL editor and run it once. Pick one way, not both.
3. **Create the first admin.** Nobody can sign in until one profile exists:
   ```sql
   insert into public.profiles (full_name, email, role)
   values ('Your Name', 'you@elevancelabs.com', 'admin');
   ```
4. **Enable Google sign-in.** Authentication → Providers → Google, with an OAuth client whose redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`.
5. **Keep the Email provider on**, with *Confirm email* on and a minimum password length of 10 or more. Workers and the agency sign in this way. Turn **sign-ups off**: every password login is made by an admin.
6. **Set the URLs.** Authentication → URL Configuration: *Site URL* is the app's address; add `http://localhost:5173/` to *Redirect URLs*.
7. **Recommended:** Authentication → Hooks → *Before User Created* → `public.hook_before_user_created`, so that someone with no profile never gets an auth user at all.
8. **Deploy the `set-password` function**, which lets admins set password logins from the app:
   ```sh
   supabase functions deploy set-password
   ```

## Setting up a worker

A worker is a computer that stays on and does the agent's jobs. It only ever connects **out** to Supabase, so nothing is opened on your network. Jobs wait while it is off.

On the computer (Windows, macOS or Linux):

1. **Install Node.js 22.18 or newer** (24 is fine). The worker is TypeScript that Node runs directly.
2. **Install Claude Code and sign in**, as the person whose Claude subscription it will use: run `claude`, then `/login`. Grow never sees these credentials; it only starts the `claude` program.
3. **Install Deno.** It is what runs collectors in a sandbox. Without it research and drafting still work; collecting does not.
4. **Get the code and its packages:** clone this repository, then `yarn install`.
5. **Give the worker its own login.** In Grow: **Settings → Add worker**. Name it, give it any address that is not a company one (for example `home-pc@grow-worker.dev`; no mail is sent to it), save, then **Set password** and copy the password.
6. **Fill in its settings:** copy `worker/.env.example` to `worker/.env` and put in the project URL and anon key (the same two the app is built with), the worker's address and that password. This file stays on that computer; it is not committed.
7. **Start it:** `yarn worker` (on Windows, `worker\start.cmd`). Within a minute **Settings** shows it *Online*, with its Claude Code version.

To keep it running on Windows, add `worker\start.cmd` to Task Scheduler with the trigger *At log on* for the same Windows user who signed in to Claude Code. It must run as that user: Claude Code's sign-in is theirs.

What the worker is, and is not, trusted with:

- **Its login is narrow.** It has no access to any table. It can claim a job, and for that job only, add steps, facts, contacts, a score, a draft or a proposal. A page that talked the model into misbehaving still could not read or change anything else.
- **Claude gets only the job's tools**: the job's own Grow tools, and web search and page fetch for jobs that read the web. No shell, no files, none of your own Claude connectors or plugins.
- **Collectors run sandboxed.** A script can reach the hosts it declared and nothing else: no files, no environment, no other sites, no code from the network. Hosts must be public names; an address on your own network is refused.
- **The quote check has the same limits.** The worker opens only public web addresses and checks every redirect.

The subscription is for one person's own use and has usage limits. When a limit is reached the job is handed back and the worker waits; **Settings** shows *At usage limit*. If Grow comes to need unattended volume or several people's runs, run Claude Code on the worker with an API key instead of a subscription sign-in (see Claude Code's documentation for how): the app and the queue do not change. Check Anthropic's current terms before relying on a subscription for shared or unattended work.

### A browser, for pages that need one

Most pages are read without a browser. For a site that only shows its text after running scripts, a browser tool server can be added in `worker/.env` (`GROW_BROWSER_SERVER`, see `worker/.env.example`). It is **off by default**. If you turn it on: pin a version you have looked at, give it its own profile folder, and sign that profile in to nothing. It is offered only to jobs that read the web.

LinkedIn is not read by the agent, with or without a browser: its terms forbid it. Each person on an account has a **Find on LinkedIn** link, which opens a search for you to look yourself.

## Collectors

A collector is a TypeScript module that returns the businesses on one source as rows:

```ts
import { getText, tableRows } from './helpers.ts'
export default async function collect() {
  const html = await getText('https://example.org/list')
  return tableRows(html).slice(1).map((cells) => ({
    name: cells[0], city: cells[1], state: 'OH',
    source_url: 'https://example.org/list', raw: cells.join(' | '),
  }))
}
```

[`worker/sandbox/helpers.ts`](worker/sandbox/helpers.ts) is all it may import: polite fetching (one request a second), HTML tables and links, CSV. The agent writes a collector and tests it in the sandbox; what an admin sees before approving is its code, the hosts it calls, what the source's terms say, and a sample from the worker's own run of it. A changed collector is a new version and must be approved again. Rows are deduplicated by name, city and state, in the script's output and again in the database; a business you rejected is not collected again.

## Run locally

```sh
cp .env.example .env    # fill in the Supabase URL and anon key
yarn install
yarn dev                # http://localhost:5173
```

| Command | Does |
| --- | --- |
| `yarn dev` | The app, on port 5173 |
| `yarn build` | Typecheck, then build to `dist/` |
| `yarn lint` | oxlint; warnings fail |
| `yarn typecheck` | The app, the tests and the worker |
| `yarn test` | Behaviour tests: the app in jsdom against an in-memory Supabase, and the worker's own code |
| `yarn test:sql` | The database's rules, as real signed-in people against a throwaway Postgres |
| `yarn check:schema` | Proves `supabase/schema.sql` equals the migrations |
| `yarn worker` | Starts the worker on this computer |

`test:sql` and `check:schema` need the Postgres server binaries on `PATH` (for example `brew install postgresql@16`).

## Deploy

Push to `main`: the workflow lints, typechecks, tests, builds and publishes to GitHub Pages. Set the repository Variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (and `VITE_SUITE_*_URL` if an app lives somewhere other than the sibling folder). The repository is expected at `…/elevance-grow/` beside the other three.

## One shell, one sign-in

Work, Support, People and Grow wear the same shell, and the grid icon at the top left switches between them without asking you to sign in again (it hands your company email to the next app as a hint; who gets in is still that app's decision). The theme (light, dark or the device's) and the collapsed navigation are remembered across all four. Grow can be installed as an app from **Install** at the foot of the navigation.

## Things worth knowing

- **Nothing is sent from Grow.** No email, no message, no post. Drafts are copied out.
- **Do not contact** on an account stops drafts being written or marked sent for it.
- **A page asks again only while something is running**, every few seconds. An idle page is quiet.
- **Evidence is kept as a snippet**: the page's words around each quote, not the whole page.
- **Tokens are recorded per run** (Claude Code reports them), so the cost of moving to an API key can be read off real runs.
- **Not built yet:** the content calendar, product ideas and their hand-over to Work, platform analytics, scheduled runs, and a command bar. Search Console, Analytics and LinkedIn numbers come with the marketing part.
- **Not yet proven end to end:** the app, the database rules and the worker's code are tested, but the worker has not yet been run against a real Claude Code sign-in and Deno on the Windows computer. The first run there is the test of the Claude Code command options and the sandbox flags (`worker/claude.ts`, `worker/collector.ts`).
