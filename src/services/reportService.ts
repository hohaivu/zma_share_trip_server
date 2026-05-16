import { HttpError } from '../http-error'
import * as reportRepository from '../repositories/reportRepository'
import { Report } from '../types/entities'
import { CreateReportPayload } from '../types/payloads'

const VALID_REPORT_REASONS = new Set([
  'no_show',
  'unsafe_behavior',
  'misleading_route',
  'harassment',
  'spam',
  'fake_profile',
])

export async function createReport(
  payload: CreateReportPayload,
): Promise<Report> {
  if (!VALID_REPORT_REASONS.has(payload.reason)) {
    throw new HttpError(400, 'Invalid report reason')
  }

  return reportRepository.createReport(payload)
}

export async function listReportsByReporter(userId: string): Promise<Report[]> {
  return reportRepository.listReportsByReporter(userId)
}
