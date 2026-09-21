import type { Chunk } from "@/types";

/**
 * 10 preset chunks — 6 worthy, 4 not worthy.
 * Each is ≥600 characters to simulate realistic memory ingestion payloads.
 * Intentionally designed to interact with the seeded memories in db.ts.
 */
export const PRESET_CHUNKS: Chunk[] = [
  {
    id: 0,
    label: "Alice's Technical Preferences",
    text: `Alice has been a consistent advocate for Python as the team's primary backend language, but her preferences go well beyond just language choice. During code reviews, she rejects PRs that lack proper type hints, citing maintainability issues in dynamically typed codebases at scale. She insists on strict mypy configuration with disallow_untyped_defs enabled across all services. Her preferred concurrency model is asyncio with async/await patterns, and she considers threading an anti-pattern for I/O bound workloads. She manages dependencies exclusively through Poetry, not pip with requirements.txt, for reproducible builds. Additionally, Alice has recently shifted her preference from Flask to FastAPI for all new HTTP services, citing automatic OpenAPI documentation generation and Pydantic validation as primary motivators. She has documented these preferences in the team wiki and reinforced them repeatedly in architecture review sessions.`,
  },
  {
    id: 1,
    label: "Weather Small Talk",
    text: `The weather today was quite pleasant compared to the past few days we have been having in this region. There was some light cloud cover during the morning hours but by midday the sun had come out and it felt noticeably warmer outside than it had been lately. Several colleagues mentioned they went for a walk during the lunch break just to enjoy the mild and comfortable conditions. The temperature was warm enough that nobody needed to bring a jacket. A few people were commenting in the chat that it was a welcome break from the consistently rainy days we had experienced throughout most of last week. Overall it was just a nice, unremarkable, comfortable day weather-wise with nothing particularly worth recording or noting from a professional or informational standpoint.`,
  },
  {
    id: 2,
    label: "JWT Auth Migration Event",
    text: `On March 12, 2025, the engineering team completed a full migration of the internal authentication system from legacy session-based cookies to JSON Web Tokens with role-based access control. The migration was led by the infrastructure team and took approximately six weeks to complete safely without downtime. The new JWT-based auth system uses RS256 asymmetric signing, with tokens issued for a 15-minute access window and a 7-day refresh window. RBAC policies are now enforced at the API gateway level rather than within individual services. The migration required coordinated updates across eleven microservices, two mobile applications, and the main web dashboard. All legacy session tables were archived and will be purged after a 90-day retention period ending June 2025. Post-migration metrics show a 34% reduction in authentication-related support tickets.`,
  },
  {
    id: 3,
    label: "Bob's Lunch Routine",
    text: `Bob usually tends to grab lunch sometime around noon most days of the week when he is in the office, which is only a few days since the team went hybrid. He typically goes to one of the nearby spots close to the building, often the sandwich place on the corner or the salad bar that opened recently on the second floor of the adjacent building. Sometimes he eats at his desk if he is busy or has a meeting running over into the lunch window. On Fridays he often joins a few other team members for a slightly longer lunch at a restaurant nearby, which has become somewhat of an informal team tradition. There is nothing particularly strategic or professionally relevant about his lunch habits, but his colleagues know roughly when he will be away from his desk.`,
  },
  {
    id: 4,
    label: "API Input Validation Rule",
    text: `A core procedural rule established by the security and backend team states: never trust data arriving from external sources or user-controlled inputs without explicit validation at every system boundary. This rule applies universally — to REST API handlers, GraphQL resolvers, CLI argument parsers, webhook processors, and background job queues. All incoming data must be validated against a strict schema using Pydantic models before any business logic executes. SQL parameters must always be passed as parameterized values, never interpolated into query strings. File upload handlers must validate MIME types, check file size limits, and scan content before writing to disk or cloud storage. The rule extends to internal service-to-service communication: even trusted internal callers must submit data conforming to the defined contract schema, as trust cannot be assumed even within the private network perimeter.`,
  },
  {
    id: 5,
    label: "General Busy Day",
    text: `It was a pretty busy day at the office overall from what I could tell just by looking around at how everyone seemed to be quite occupied with various things going on. There were a number of meetings scheduled throughout the day which kept many people in conference rooms or on video calls for long stretches of time. The general energy in the space felt high and productive, though it was hard to say exactly what most people were working on from just casual observation. Some teams appeared to be dealing with some kind of deadline or deliverable based on the level of focus and the number of people working with headphones on. By the afternoon things seemed to slow down slightly but remained fairly active. Nothing particularly noteworthy happened from a factual or informational standpoint that would be worth recording as a specific memory.`,
  },
  {
    id: 6,
    label: "Project Nexus Launch",
    text: `Project Nexus officially launched in Q2 2025 after an extended planning and design phase that began in late 2023. The product targets mid-market and enterprise clients in the B2B SaaS segment, focusing on workflow automation for operations teams. The initial launch covered five industry verticals: logistics, healthcare administration, legal operations, financial services, and HR management. The enterprise tier is priced at $2,400 per seat annually with a minimum contract size of 25 seats. Early access customers from the beta program were converted at a discounted rate as part of the retention agreement. The initial ARR target set at launch is $4.2 million by end of 2025, with a burn-down to profitability modeled at month 18 post-launch. The product team is led by the former VP of Product from a successful Series C startup, hired specifically for this initiative.`,
  },
  {
    id: 7,
    label: "Carol's Communication Preferences",
    text: `Carol has expressed a clear and consistent preference for asynchronous communication over real-time synchronous interactions. She finds video calls disruptive to deep work blocks and has explicitly requested that teammates default to written updates in Slack, Notion documents, or recorded Loom videos instead of scheduling live meetings. She makes exceptions for high-stakes decisions that require group alignment and for one-on-one check-ins, but considers recurring status meetings largely wasteful and prefers status updates through structured written reports. Carol also strongly dislikes meetings scheduled before 10 AM, as she does her most focused engineering work in the early morning hours and protects that block rigorously. She has documented this preference in her personal working style document shared with the team, and has raised it during team retrospectives when recurring early meeting patterns emerge.`,
  },
  {
    id: 8,
    label: "Random Trivia",
    text: `The blue whale is considered the largest animal known to have ever existed on Earth, reaching lengths of up to 33 meters and weighing as much as 200 tonnes. Despite their enormous size, blue whales feed almost exclusively on krill, tiny shrimp-like crustaceans, consuming up to 40 million of them per day during peak feeding season. Their hearts alone can weigh as much as an automobile and beat only a few times per minute during deep dives. Blue whales communicate through low-frequency vocalizations that can travel thousands of kilometers through ocean water. They were nearly hunted to extinction during the 20th century whaling era and remain endangered today with global populations estimated at between 10,000 and 25,000 individuals. This information has no connection to any professional context, team event, personal preference, or operational process.`,
  },
  {
    id: 9,
    label: "Rate Limiting Policy",
    text: `The updated API rate limiting policy, effective as of April 2025, establishes a hard limit of 1,000 requests per minute per API key for all external integrations, increased from the previous limit of 500 requests per minute. Burst capacity allows up to 150 requests in any 5-second window before throttling engages. All clients receiving a 429 Too Many Requests response must implement exponential backoff with full jitter starting at a 1-second base delay, doubling on each retry up to a maximum of 60 seconds, with a maximum of 5 retry attempts before surfacing an error to the end user. Retry-After headers are included in all 429 responses and must be respected. API keys found repeatedly ignoring backoff signals will be flagged for review and may be temporarily suspended. The policy applies to all production API keys; sandbox keys have separate limits of 100 requests per minute.`,
  },
];
