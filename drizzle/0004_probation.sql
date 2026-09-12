-- Phase 1, probation confirmation.
--
-- Records the circle's decision at the end of the manifesto's six months as its
-- own timestamp, so a confirmed member is distinguishable from one who never
-- had a probation clock, and the date of the decision survives.
ALTER TABLE "user" ADD COLUMN "probation_confirmed_at" timestamp with time zone;