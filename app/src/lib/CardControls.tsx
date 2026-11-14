import type { CardRow } from '../db/schema'
import { addCard, removeCard, setSuspended, type CardRef } from './cards'
import { nextReviewText } from './time'

/** Review status + actions shared by the word and entry pages. `card` must be live (or null). */
export function CardControls({ cardRef, card }: { cardRef: CardRef; card: CardRow | null }) {
  const suspended = !!card?.suspended
  return (
    <>
      {card ? (
        <div className="card inreview" data-testid="inreview">
          <div>
            {suspended
              ? <><strong>Known</strong> · not reviewed</>
              : <><strong>In review</strong> · {card.state === 0 ? 'new card' : `next: ${nextReviewText(card).replace('Next review: ', '')}`}</>}
          </div>
          <button className="link" onClick={() => removeCard(card.id)}>Remove</button>
        </div>
      ) : (
        <button className="primary big" onClick={() => addCard(cardRef)}>Add to review</button>
      )}
      <p>
        {suspended
          ? <button className="link" onClick={() => setSuspended(cardRef, false)}>Unsuspend (review again)</button>
          : <button className="link" onClick={() => setSuspended(cardRef, true)}>Mark as known (stop reviewing)</button>}
      </p>
    </>
  )
}
