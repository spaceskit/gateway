/**
 * WorkflowVisualizer — generates Mermaid diagrams from space execution.
 *
 * Creates visual representations of:
 * - Turn sequences between agents
 * - Turn model strategy topology
 * - Agent interaction patterns
 */

import type { TurnModelStrategy } from "@spaceskit/core";
import type { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowDiagram {
  format: "mermaid";
  content: string;
  spaceId: string;
  generatedAt: Date;
}

export interface TurnRecord {
  turn_id: string;
  actor_id: string;
  actor_type: string;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class WorkflowVisualizer {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Generate a Mermaid sequence diagram of space turn history.
   */
  generateTurnSequenceDiagram(spaceId: string): WorkflowDiagram {
    const turns = this.db.prepare(
      "SELECT turn_id, actor_id, actor_type, status, created_at FROM turns WHERE space_id = ? ORDER BY created_at",
    ).all(spaceId) as TurnRecord[];

    if (!turns || turns.length === 0) {
      return {
        format: "mermaid",
        content: `sequenceDiagram\n  Note over User: No turns recorded for this space`,
        spaceId,
        generatedAt: new Date(),
      };
    }

    let diagram = "sequenceDiagram\n";
    diagram += "  participant User\n";

    // Collect unique agents
    const agents = new Set<string>();
    for (const turn of turns) {
      if (turn.actor_type === "agent") agents.add(turn.actor_id);
    }
    for (const agent of agents) {
      diagram += `  participant ${sanitize(agent)}\n`;
    }

    // Generate sequence
    let lastActor = "User";
    for (const turn of turns) {
      const actor = turn.actor_type === "user" ? "User" : sanitize(turn.actor_id);
      const status = turn.status === "failed" ? " [FAILED]" : "";

      if (lastActor !== actor) {
        diagram += `  ${lastActor}->>+${actor}: Turn${status}\n`;
        diagram += `  ${actor}-->>-${lastActor}: Response\n`;
      } else {
        diagram += `  Note over ${actor}: Self-turn${status}\n`;
      }

      lastActor = actor;
    }

    return {
      format: "mermaid",
      content: diagram,
      spaceId,
      generatedAt: new Date(),
    };
  }

  /**
   * Generate a Mermaid flowchart showing the turn model strategy.
   */
  generateStrategyDiagram(
    strategy: TurnModelStrategy,
    agents: string[],
  ): WorkflowDiagram {
    let diagram = "graph TD\n";

    switch (strategy) {
      case "sequential_all":
        diagram += "  Input([User Input])\n";
        agents.forEach((agent, i) => {
          const id = sanitize(agent);
          diagram += `  ${id}["${agent}"]\n`;
          if (i === 0) diagram += `  Input --> ${id}\n`;
          else diagram += `  ${sanitize(agents[i - 1])} --> ${id}\n`;
        });
        if (agents.length > 0) {
          diagram += `  ${sanitize(agents[agents.length - 1])} --> Output([Result])\n`;
        }
        break;

      case "primary_only":
        diagram += "  Input([User Input])\n";
        if (agents.length > 0) {
          diagram += `  Primary["${agents[0]} (Primary)"]\n`;
          diagram += `  Input --> Primary\n`;
          diagram += `  Primary --> Output([Result])\n`;
        }
        break;

      case "parallel_race":
        diagram += "  Input([User Input])\n";
        diagram += "  Output([First Result Wins])\n";
        for (const agent of agents) {
          const id = sanitize(agent);
          diagram += `  ${id}["${agent}"]\n`;
          diagram += `  Input --> ${id}\n`;
          diagram += `  ${id} -.-> Output\n`;
        }
        break;

      case "debate_synthesis":
        diagram += "  Input([User Input])\n";
        diagram += "  Debate{Debate Round}\n";
        diagram += `  Synth["Synthesizer"]\n`;
        diagram += "  Output([Synthesized Result])\n";
        diagram += "  Input --> Debate\n";
        for (const agent of agents) {
          const id = sanitize(agent);
          diagram += `  ${id}["${agent}"]\n`;
          diagram += `  Debate --> ${id}\n`;
          diagram += `  ${id} --> Synth\n`;
        }
        diagram += "  Synth --> Output\n";
        break;

      case "round_robin":
        diagram += "  Input([User Input])\n";
        for (let i = 0; i < agents.length; i++) {
          const id = sanitize(agents[i]);
          diagram += `  ${id}["${agents[i]}"]\n`;
          if (i === 0) diagram += `  Input --> ${id}\n`;
          else diagram += `  ${sanitize(agents[i - 1])} --> ${id}\n`;
        }
        if (agents.length > 0) {
          diagram += `  ${sanitize(agents[agents.length - 1])} -.->|next round| ${sanitize(agents[0])}\n`;
        }
        break;

      default:
        diagram += `  Note["Strategy: ${strategy}"]\n`;
    }

    return {
      format: "mermaid",
      content: diagram,
      spaceId: "template",
      generatedAt: new Date(),
    };
  }
}

/**
 * Generate HTTP handler for diagram endpoint.
 */
export function createDiagramHandler(visualizer: WorkflowVisualizer): (req: Request) => Response | null {
  return (req: Request) => {
    const url = new URL(req.url);
    const match = url.pathname.match(/^\/spaces\/([^/]+)\/diagram$/);
    if (!match) return null;

    const spaceId = match[1];
    const diagram = visualizer.generateTurnSequenceDiagram(spaceId);

    return new Response(JSON.stringify(diagram), {
      headers: { "Content-Type": "application/json" },
    });
  };
}

/** Sanitize a string for Mermaid node IDs. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}
