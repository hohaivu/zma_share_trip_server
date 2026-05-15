# Backend Context

The backend context covers the backend Module that owns matching, group request/offer flows, accepted journeys, review eligibility, and wallet accounting. It exposes Interfaces consumed by the frontend while keeping backend Implementations expressed in backend domain language.

ADRs are intentionally empty for this context; no ADR files have been created yet.

## Language

### Journey and matching

**Journey**:
The shared umbrella concept for a user travel arrangement when communicating with frontend-facing Interfaces.
_Avoid_: Using as the only backend term when **Route** or **Plan** is more precise.

**Route**:
A driver-owned travel offer with pickup, dropoff, departure, and capacity facts.
_Avoid_: Journey when driver ownership matters.

**Plan**:
A passenger-owned travel request with pickup, dropoff, departure, and passenger facts.
_Avoid_: Journey when passenger ownership matters.

**Demand group**:
A backend grouping of compatible passenger demand used for matching and offers.
_Avoid_: Passenger cluster.

**Match**:
A backend candidate linking demand with a compatible route or offer.
_Avoid_: Pairing, suggestion.

**Matched demand group**:
A demand group with at least one viable match.
_Avoid_: Matched cluster.

**Match tier**:
A classification of match quality after hard filters and scoring.
_Avoid_: Rank.

**Score**:
The numeric match quality value.
_Avoid_: Rating.

**Hard filters**:
Non-negotiable match constraints that must pass before scoring.
_Avoid_: Preferences.

**Search criteria**:
The structured pickup, dropoff, departure, and passenger constraints used by matching.
_Avoid_: Query when domain intent is meant.

### Group request and offer flow

**Group request**:
A request from a demand group to receive or join a compatible offer.
_Avoid_: Offer inbox item.

**Group offer**:
An offer sent to a demand group or member plans for acceptance or decline.
_Avoid_: Inbox offer.

**Accepted group offer**:
A group offer that has been accepted and can produce accepted Journey state.
_Avoid_: Confirmed offer.

**Declined group offer**:
A group offer that has been rejected and should no longer be treated as pending.
_Avoid_: Rejected offer.

**Member plan**:
A passenger plan included in a demand group or group offer.
_Avoid_: Passenger item.

**Member count**:
The number of member plans in a group.
_Avoid_: User count when plans are being counted.

**Total passenger count**:
The sum of passengers represented by the member plans.
_Avoid_: Member count when passenger quantity is meant.

**Pickup**:
The origin location for a route, plan, request, or offer.
_Avoid_: Start.

**Dropoff**:
The destination location for a route, plan, request, or offer.
_Avoid_: End.

**Departure block**:
The time window used for route and plan compatibility.
_Avoid_: Departure time when a range is meant.

**Request edge**:
The directional relationship between a requester and receiver in a group request flow.
_Avoid_: Link.

**Inbound request**:
A group request received by the current user or route owner.
_Avoid_: Incoming ask.

**Outbound request**:
A group request sent by the current user or demand group.
_Avoid_: Sent ask.

**Winning offer**:
The selected offer among competing compatible offers.
_Avoid_: Best offer unless selection is final.

**Pending request**:
A group request awaiting acceptance, decline, or expiry.
_Avoid_: Open request.

### Acceptance, review, and wallet

**Accepted state**:
The backend state indicating a route, plan, group request, or group offer has a confirmed counterpart.
_Avoid_: Confirmed state.

**Review eligibility**:
Whether backend facts allow a user to review a counterpart.
_Avoid_: Rating permission.

**Counterpart**:
The other user participating in an accepted Journey.
_Avoid_: Peer, partner.

**Wallet**:
The account of available and reserved balances used for Journey-related money movement.
_Avoid_: Account when money movement is meant.

**Available balance**:
Wallet funds that can be spent or reserved.
_Avoid_: Free balance.

**Reserved balance**:
Wallet funds held for a pending or accepted Journey obligation.
_Avoid_: Locked balance.

**Wallet fee**:
A fee charged through wallet accounting.
_Avoid_: Platform fee unless product language requires it.

**Reserve**:
A ledger action that moves funds from available balance to reserved balance.
_Avoid_: Hold as a noun.

**Charge**:
A ledger action that consumes reserved or available funds.
_Avoid_: Pay when ledger action is meant.

**Release**:
A ledger action that returns reserved funds to available balance.
_Avoid_: Unhold.

**Refund**:
A ledger action that returns charged funds.
_Avoid_: Release when funds were already charged.

**Ledger transaction**:
An immutable wallet accounting record.
_Avoid_: Wallet log.

**Top-up**:
An action that increases available wallet balance from an external payment source.
_Avoid_: Deposit if product language says top-up.

## Relationships

- A **Route** may match one or more **Plans** through **Demand groups** and **Group offers**.
- A **Demand group** contains one or more **Member plans**.
- **Member count** counts plans; **Total passenger count** counts passengers represented by those plans.
- **Hard filters** must pass before **Score** and **Match tier** are assigned.
- A **Group request** has a **Request edge** and may be **Inbound** or **Outbound** from the current user's perspective.
- An **Accepted group offer** can create or reflect an **Accepted state** with a **Counterpart**.
- **Wallet** money movement is recorded through **Ledger transactions** such as **Reserve**, **Charge**, **Release**, **Refund**, and **Top-up**.

## Example dialogue

> **Dev:** “Should the backend call this screen data the **Offer inbox**?”  
> **Domain expert:** “No. The backend owns **Group requests** and **Group offers**. **Offer inbox** is the frontend Adapter language.”  
> **Dev:** “When a group accepts, do we count users or passengers?”  
> **Domain expert:** “Use **Member count** for plans in the group and **Total passenger count** for represented passengers.”

## Flagged ambiguities

- **Journey** is allowed at backend Interfaces, but backend Implementations should prefer **Route**, **Plan**, **Group request**, and **Group offer** where precision matters.
- **Offer inbox** is not backend core language; use it only when discussing frontend-facing adapters.
- **Member count** and **Total passenger count** are distinct and should not be collapsed.
- **Release** and **Refund** are different wallet ledger actions: release returns reserved funds; refund returns charged funds.
- ADRs are intentionally empty and not created yet.
