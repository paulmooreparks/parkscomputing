---
title: Set-Associative Cache in C#, Part 3: Implementation
description: Set-Associative Cache in C#
date: 2024-08-30T21:19:00Z
lastModified: 2024-08-30T21:19:00Z
commentsAllowed: false
commentsEnabled: false
lang: en-us
---

# Set-Associative Cache in C#, Part 3: Implementation

For my implementation, I chose to create a generic collection type very similar to the [System.Collections.Generic.IDictionary<TKey, TValue>](https://docs.microsoft.com/en-us/dotnet/api/system.collections.generic.idictionary-2?view=net-5.0) interface. It seemed the most intuitive interface to start with, since the implementation of the cache is somewhat similar to that of a dictionary.

```csharp
using System.Collections.Generic;

namespace ParksComputing.SetAssociativeCache {

    // Represents a generic set-associative cache of key/value pairs.
    public interface ISetAssociativeCache<TKey, TValue> : IDictionary<TKey, TValue> {
        // Gets the capacity of the cache.
        int Capacity { get; }

        // Gets the number of sets in the cache.
        int Sets { get; }

        // Gets the capacity in each set.
        int Ways { get; }

        // If the given key would cause an existing cache item to be evicted, returns true and sets
        // evictKey to the key of the cache item that would be evicted if the new key were added.
        bool TryGetEvictKey(TKey key, out TKey evictKey);
    }
}
```

This interface will be implemented by concrete classes which provides the behavior of the set-associative cache. Since there are multiple policies to choose from for cache eviction, and the implementation of those policies

## Implementation

Now that we have settled on the basic design of the set-associative cache, and we've defined the interface, it's time to work on the implementation.

```csharp
const ulong offsetBasis = 14695981039346656037;
const ulong prime = 1099511628211;

public static ulong GetHashValue<T>(this T key) {
    if (key == null) {
        throw new ArgumentNullException(nameof(key));
    }

    ulong hash = offsetBasis;
    char[] chars = key.ToString().ToCharArray();

    foreach (char c in chars) {
        hash ^= c;
        hash *= prime;
    }

    return hash;
}
```

```csharp
protected int FindSet(TKey key) {
    if (key == null) {
        throw new ArgumentNullException(nameof(key));
    }

    ulong keyHash = key.GetHashValue();
    return (int)(keyHash % (ulong)sets_);
}
```

## Using the Cache

Can I type some stuff here?

## Caching Policies

## Base Class

## LRU Policy

## MRU Policy

## LFU Policy
