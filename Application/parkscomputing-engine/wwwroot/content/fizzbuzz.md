---
title: FizzBuzz
description: My implementation of FizzBuzz in C++.
date: 2022-12-01T03:57:03Z
lastModified: 2025-08-24T12:00:05+08
commentsAllowed: false
commentsEnabled: false
lang: en-us
---

# FizzBuzz

The [FizzBuzz test](https://en.wikipedia.org/wiki/Fizz_buzz) is just one of those things you have to write, apparently. Before anyone asks, here is mine, in C++.

```cpp
#include <iostream>

int main() {
    int three_counter {0};
    int five_counter {0};

    for (int i = 1; i <= 100; ++i) {
        ++three_counter;
        ++five_counter;

        if (three_counter == 3) {
            three_counter = 0;
            std::cout << "Fizz";
        }

        if (five_counter == 5) {
            five_counter = 0;
            std::cout << "Buzz";
        }

        if (three_counter > 0 && five_counter > 0) {
            std::cout << i;
        }

        std::cout << " ";
    }
}
```

## The Motivation

FizzBuzz is a very simple programming test designed to see if, for example, an interview candidate has any inkling at all about how to write code. If a developer can't write FizzBuzz, that developer is probably going to have trouble with more complex tasks. Since I'm currently in interview-prep mode, I thought I'd give it a whirl just for fun.

## The Explanation

The stock answer is to use a modulo operator (%) to test if the number is divisible by three or by five. That's typically slower than simply incrementing a register, however. What I'm doing instead is maintaining separate counters, one for every three numbers counted and another for every five numbers counted. When one of these reaches its target number, I output "Fizz" or "Buzz" as appropriate. If both have reached their targets, the output is "FizzBuzz". If neither counter has been reset to zero, then the output is the current number.

See the [compilation on GodBolt.org](https://godbolt.org/z/MefoavTob) for an idea how this compiles to assembly language for your compiler and CPU of choice.

Drink up, and let the debate begin.

![FizzBuzz](/images/fizzbuzz.png){ width=512 height=512 }
