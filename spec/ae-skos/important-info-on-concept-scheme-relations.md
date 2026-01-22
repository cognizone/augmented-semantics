
So, let's analyze some very related stuff here. Because it seems to get mixed up all the time.

So, a SKOS can have following properties for concepts being present in a scheme
- inScheme, the great default
- topConceptOf, for top concepts
- hasTopConcept, also for top concepts
- narrower, for hierarchy, except top concepts
- broader, also for hierarchy, except top concepts
- narrowerTransitive, shortcut for narrower*
- broaderTransitive, shortcut for broader*

Typically a triplestore only has a subset of these 7 properties being used.
So, when navigating we must only use the properties present in the triplestore.

Now, let's discuss some things in detail


= Finding

== Top Concepts

Top concepts in a scheme can be found by doing either
- topConceptOf, hasTopConcept
- special case: inScheme in case the referenced concept does not have any narrower/broader/narrowerTransitive/broaderTransitive/topConceptOf/hasTopConcept
  - this more or less is for concept which are clearly part of the scheme but do not seem to have a formal position yet
  - or often for a flat list this is being used

Query should only use fields present in triplestore.
Special case "top concepts" need a special indicator, so we can see they are not real top concepts!

== Child Concepts

Child concepts are found using
- narrower
- broader

