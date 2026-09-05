# SYSTEM ARCHITECTURE

## Recommended MVP style
Modular Monolith with explicit domain modules and domain events.

## Why
- lower operational complexity
- easier transaction consistency
- lower cost
- suitable for MVP
- clear boundaries for multi-agents
- can extract services later if needed

## Logical modules
Identity
Fleet
Trips
Reservations
Approvals
MobilityIntelligence
Inspections
Operations
Communications
Notifications
Configuration
Audit

## Frontend
- Web application
- Mobile-first responsive experience / PWA preferred for MVP unless native app is explicitly required later

## Backend
- REST or contract-first HTTP API
- relational database
- object storage for evidence photos
- background job runner for notifications and scheduled checks

## Key architecture rules
- domain logic not in UI
- controllers thin
- state changes only via application/domain services
- no direct cross-module DB writes
- use domain events for side effects where practical
- configuration-driven policies
