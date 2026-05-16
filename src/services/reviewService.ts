import { HttpError } from '../http-error'
import * as journeyRepository from '../repositories/journeyRepository'
import * as reviewRepository from '../repositories/reviewRepository'
import { Review } from '../types/entities'
import { CreateReviewPayload } from '../types/payloads'

export async function createReview(
  payload: CreateReviewPayload,
): Promise<Review> {
  if (
    !Number.isInteger(payload.rating) ||
    payload.rating < 1 ||
    payload.rating > 5
  ) {
    throw new HttpError(400, 'rating must be an integer between 1 and 5')
  }

  const eligibility = await journeyRepository.getReviewEligibility(
    payload.tripId,
    payload.reviewerId,
  )
  if (!eligibility.canSubmit) {
    const status = eligibility.reason === 'already_submitted' ? 409 : 400
    const message =
      eligibility.reason === 'outside_window'
        ? 'Review window has closed'
        : eligibility.reason === 'already_submitted'
          ? 'Review already exists for this trip'
          : `Review is not allowed: ${eligibility.reason}`
    throw new HttpError(status, message)
  }
  if (eligibility.revieweeId !== payload.revieweeId) {
    throw new HttpError(400, 'Reviewee must be the accepted counterpart')
  }

  try {
    return await reviewRepository.createReview(payload)
  } catch (error) {
    if (
      reviewRepository.isPgUniqueViolation(
        error,
        'reviews_unique_trip_reviewer_reviewee',
      )
    ) {
      throw new HttpError(409, 'Review already exists for this trip')
    }
    throw error
  }
}

export async function listReviewsByReviewer(userId: string): Promise<Review[]> {
  return reviewRepository.listReviewsByReviewer(userId)
}
