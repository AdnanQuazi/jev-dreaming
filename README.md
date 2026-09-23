# Jev Dreaming Benchmark

A comprehensive benchmarking suite designed to evaluate the **Dreaming Architecture** (a hybrid pipeline using [TypeSafe AI's Jev](https://typesafe-ai.com) for chunk triage/mutation and Gemini for memory generation) against a purely LLM-based architecture (using Gemini for all stages). 

This benchmark evaluates system performance based on three primary pillars:
- **Speed & Latency**: Measures relative execution speed using precise performance timing.
- **Cost**: Calculates exact token usage costs based on model pricing models.
- **Quality**: Utilizes a Gemini 3.8 Flash automated judge to score Fact Completeness, Noise Filtration, and Mutation Accuracy (Append, Supersede, Link/Extend).

## Features

- **Interactive Knowledge Graph**: Visualizes active, superseded, and extended memories dynamically using `react-force-graph-2d`.
- **Sandboxed Benchmarking**: Safely run Full Benchmark simulations that automatically isolate database state to prevent test contamination.
- **Persistent Keep-Alive**: Configured with a dedicated HTTP agent to maintain connection pooling for Jev API calls, reducing TLS/TCP handshake latency.

## Getting Started

### Prerequisites

You will need API keys for both Gemini and TypeSafe AI.
Create a `.env.local` file in the `app/` directory and add your keys:

```env
GEMINI_API_KEY=your_gemini_api_key_here
TYPESAFE_API_KEY=your_typesafe_api_key_here
```

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/AdnanQuazi/jev-dreaming.git
   cd jev-dreaming/app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) with your browser to access the benchmarking UI.

## How to Use

1. **Input Chunks**: Add or edit the text chunks on the left panel. These represent the incoming stream of user conversations, system logs, or documents.
2. **Select Model**: Choose the Gemini model you want to act as the generation engine (e.g., Gemini 3.5 Flash).
3. **Run Pipeline**:
   - **Dream with Jev**: Runs the 3-stage Jev-gated pipeline. Extracted memories and relationship mutations are actively written to your local `IndexedDB` memory store.
   - **Full Benchmark (Jev vs Gemini)**: Runs both the Jev-optimized pipeline and the standalone Gemini pipeline sequentially in a sandboxed mode. No mutations are permanently written to the database. An LLM quality judge will evaluate the runs, and side-by-side graph visualizations will display the resulting knowledge topologies.

## Tech Stack
- Next.js (App Router)
- React Force Graph 2D
- Tailwind CSS
- IDB (IndexedDB)
- TypeSafe AI SDK
- Google Generative AI SDK
