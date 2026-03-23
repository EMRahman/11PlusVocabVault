# Quiz UI improvement suggestions

## Priority 1: Improve one-handed iPhone use

1. **Add a persistent bottom action area during questions.**
   Keep the progress, score, and a primary action (for example `Next` after answering) anchored near the bottom of the viewport so the main interaction stays inside thumb reach on iPhones. The current quiz places status in the top header and automatically advances after 1.4 seconds, which forces users to watch the top of the card and react quickly instead of staying focused on the answer area.

2. **Replace automatic advance with an explicit `Next question` button.**
   Auto-advancing is fast for confident desktop users, but it can feel rushed on mobile, especially when the feedback includes the correct answer after a mistake. A manual next step would let children read the explanation at their own pace and reduce accidental cognitive overload.

3. **Increase spacing and vertical rhythm on the question screen.**
   The question card and answer grid are compact. On iPhone screens, adding more separation between the prompt, answers, and feedback would make the flow feel less cramped and reduce mistaps.

4. **Make the close/dismiss affordance larger and more obvious.**
   The close button currently sits in the standard modal position, but a more prominent top-right target plus a secondary `Back to words` option on setup/question screens would feel safer on touch devices.

## Priority 2: Make answer choices easier to scan on both mobile and desktop

5. **Use a single-column answer list by default until wider desktop breakpoints.**
   The current 2-column layout can create zig-zag eye movement and uneven card heights when definitions are longer. A single vertical stack is easier on iPhone, and a 2-column layout can still be reintroduced only on comfortably wide laptop/desktop screens.

6. **Add answer labels such as `A`, `B`, `C`, `D` and stronger selected states.**
   Labels improve verbal guidance (`Try B`) and help keyboard users on desktop. A pressed/selected state before showing correctness would also make tap and click feedback clearer.

7. **Clamp long answer text more carefully or rebalance question types.**
   When the question asks for a definition, answer choices can become multi-line blocks. That increases scroll/scan effort on phones and creates visually noisy grids on desktop. Consider shortening displayed definitions, adding a short hint line, or preferring a single-column layout for definition answers.

## Priority 3: Better adapt the layout for PC/Mac browsers

8. **Use a wider desktop quiz shell with split information hierarchy.**
   The quiz panel is capped at 540px, which is comfortable on mobile but leaves a lot of empty space on desktop. On PC/Mac browsers, a wider panel could show the question on the left and answers/feedback on the right, or at least allow a roomier single-column card with a more spacious header.

9. **Turn setup choices into real segmented controls/cards on desktop.**
   The setup screen currently uses full-width stacked buttons. On larger screens, card-like options for quiz length, difficulty, and word scope would make better use of space and help users understand the configuration before they start.

10. **Improve keyboard-first flow for desktop browsers.**
    Add visible focus to the first answer, arrow-key navigation between options, and keyboard shortcuts such as `1-4` or `A-D`. The markup already uses buttons, so the workflow is close, but the current logic only handles mouse/touch clicks for answers.

## Priority 4: Add clarity and reassurance throughout the workflow

11. **Show a short helper line before the quiz starts.**
    Explain the two question types and how scoring works. The setup subtitle mentions a mixed quiz, but it does not really set expectations.

12. **Add lightweight review context after each answer.**
    After a wrong answer, show the correct word plus one supporting detail such as pronunciation or a short example. This would turn the feedback strip into a learning moment instead of just a correctness signal.

13. **Show progress in words as well as visually.**
    The progress bar is good, but adding a `7 questions left` style helper would be especially helpful for younger users and for mobile users who may not interpret a thin progress bar as quickly.

14. **Add an end-of-quiz review list.**
    On desktop this could be a compact summary table; on mobile it could be an accordion list of missed words. That would make the quiz feel more valuable as a study tool instead of a one-pass game.

## Recommended implementation order

1. Replace auto-advance with a `Next question` CTA and keep feedback visible until tapped.
2. Switch answer choices to a default single-column stack, only enabling 2 columns at wider desktop breakpoints.
3. Introduce a bottom action bar for mobile and a wider panel layout for desktop.
4. Add keyboard shortcuts and richer review details after answers and at the end.
