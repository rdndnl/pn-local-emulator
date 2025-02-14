import { flow, pipe, identity } from 'fp-ts/lib/function';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';
import * as RA from 'fp-ts/ReadonlyArray';
import { ProgressResponse } from '../generated/streams/ProgressResponse';
import {
  NewStatusEnum,
  ProgressResponseElement,
  TimelineEventCategoryEnum,
} from '../generated/streams/ProgressResponseElement';
import { NotificationRequest } from './NotificationRequest';
import { Notification } from './Notification';
import { Record, AuditRecord } from './Repository';
import { Response, UnauthorizedMessageBody } from './types';
import { DomainEnv } from './DomainEnv';
import { computeSnapshot } from './Snapshot';
import { authorizeApiKey } from './authorize';

export type ConsumeEventStreamRecord = AuditRecord & {
  type: 'ConsumeEventStreamRecord';
  input: { apiKey: string; streamId: string; lastEventId?: string };
  output: Response<200, ProgressResponse> | Response<403, UnauthorizedMessageBody> | Response<419>;
};

export const isConsumeEventStreamRecord = (record: Record): O.Option<ConsumeEventStreamRecord> =>
  record.type === 'ConsumeEventStreamRecord' ? O.some(record) : O.none;

export const getProgressResponse = (record: ConsumeEventStreamRecord): O.Option<ProgressResponse> =>
  record.output.statusCode === 200 ? O.some(record.output.returned) : O.none;

export const getProgressResponseList = flow(RA.filterMap(getProgressResponse), RA.flatten);

const makeProgressResponse = (timestamp: Date) =>
  RA.chain(
    E.fold(
      flow(makeProgressResponseElementFromNotificationRequest(timestamp), RA.of),
      makeProgressResponseElementFromNotification(timestamp)
    )
  );

const makeProgressResponseElementFromNotification =
  (timestamp: Date) =>
  (notification: Notification): ReadonlyArray<ProgressResponseElement> =>
    pipe(
      notification.timeline,
      RA.map(({ category }) => ({
        ...makeProgressResponseElementFromNotificationRequest(timestamp)(notification),
        iun: notification.iun,
        // NotificationStatusEnum and NewStatusEnum have the same values
        newStatus: notification.notificationStatus as unknown as NewStatusEnum,
        // TimelineElementCategoryEnum, and TimelineEventCategoryEnum have the same values
        timelineEventCategory: category as unknown as TimelineEventCategoryEnum,
      }))
    );

const makeProgressResponseElementFromNotificationRequest =
  (timestamp: Date) =>
  (notificationRequest: NotificationRequest): ProgressResponseElement => ({
    eventId: '0',
    timestamp,
    notificationRequestId: notificationRequest.notificationRequestId,
  });

export const makeConsumeEventStreamRecord =
  (env: DomainEnv) =>
  (input: ConsumeEventStreamRecord['input']) =>
  (records: ReadonlyArray<Record>): ConsumeEventStreamRecord => ({
    type: 'ConsumeEventStreamRecord',
    input,
    output: pipe(
      authorizeApiKey(input.apiKey),
      E.foldW(identity, () =>
        pipe(
          computeSnapshot(env)(records),
          // create ProgressResponse
          makeProgressResponse(env.dateGenerator()),
          // override the eventId to create a simple cursor based pagination
          RA.mapWithIndex((i, elem) => ({ ...elem, eventId: i.toString() })),
          RA.filterWithIndex((i) => i > parseInt(input.lastEventId || '-1', 10)),
          (output) => ({ statusCode: 200 as const, headers: { 'retry-after': env.retryAfterMs }, returned: output })
        )
      )
    ),
    loggedAt: env.dateGenerator(),
  });
