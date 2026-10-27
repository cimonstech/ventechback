-- Rolls back 20261027_03_service_tickets.sql.
-- Drops events, media, tickets, issue types, then the ticket number sequence.

BEGIN;

DROP TABLE public.ticket_events;
DROP TABLE public.ticket_media;
DROP TABLE public.service_tickets;
DROP TABLE public.ticket_issue_types;
DROP SEQUENCE public.service_ticket_no_seq;

COMMIT;
