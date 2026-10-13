import { Data } from 'effect';
export class CommandRejected extends Data.TaggedError('CommandRejected')<{ message: string }> {}
