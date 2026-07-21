// Turn execution core is shared with the machine daemon (@swarmdev/shared):
// adapter table, stream parsing, and process execution must not drift apart.
export {
  ADAPTERS,
  RUNTIME_CODE_CAPABILITIES,
  RunnerError,
  extractPlainReply,
  lowerPermission,
  parseClaudeStreamLine,
  redactDiagnostic,
  runTurn,
  type ClaudeStreamState,
  type RuntimeCodeCapability,
  type TurnCredentials,
  type TurnPermission,
  type TurnRequest,
  type TurnResult,
} from '@swarmdev/shared';
