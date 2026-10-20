-- Never erase assignments, custody evidence or audit history to roll back UI.
do $$begin raise exception 'FORWARD_CORRECTION_REQUIRED';end$$;
