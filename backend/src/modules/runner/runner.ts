// Turn execution core is shared with the machine daemon (@swarmdev/shared):
// adapter table, stream parsing, and process execution must not drift apart.
export {
  ADAPTERS,
  RunnerError,
  extractPlainReply,
  parseClaudeStreamLine,
  redactDiagnostic,
  runTurn,
  type ClaudeStreamState,
  type TurnCredentials,
  type TurnRequest,
  type TurnResult,
} from '@swarmdev/shared';
