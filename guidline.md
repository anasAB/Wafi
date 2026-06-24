A Complete Handbook for Modern React Development
Version: 1.0
Last Updated: June 24, 2026
Audience: Junior → Senior Frontend Developers
Stack: TypeScript, React, Redux Toolkit
📖 How to Use This Document
This is a living reference, not a novel. Don't try to read it all at once.
New to the team? Start with Part 0: Mid-Level Developer Survival Guide
Working on a feature? Check Part 3: Daily Development Practices
Doing a code review? Jump to Section 32: Code Review Checklist
Debugging a bug? Read Section 48: Systematic Debugging
Making an architecture decision? Check Part 4: Architecture & Patterns
🗂️ Table of Contents
Part 0: Mid-Level Developer Survival Guide
47. Your First Week: Learning Path
48. Systematic Debugging Methodology
49. Navigating an Unfamiliar Codebase
50. Breaking Down Large Tasks
51. Code Review: Giving & Receiving
52. Git Workflow: Practical Guide
53. Task Estimation
54. When & How to Ask for Help
55. Writing Effective PR Descriptions
Part 1: Foundation & Philosophy
1. The Core Philosophy
2. TypeScript & JavaScript Fundamentals
3. React Best Practices
4. State Management (Redux)
5. Project Structure & Naming
Part 2: Writing Clean Code
6. Writing Clean Methods & Functions
7. Code Styling & Syntax
8. The Great Debates
9. Naming Conventions
20. Comments & Documentation
21. Keeping JSX Clean
Part 3: Daily Development Practices
15. Async/Await & Error Handling
16. Forms & Validation
17. Dates, Times & Numbers
18. Environment Variables
19. i18n & Hardcoded Strings
22. CSS & Styling Architecture
37. Testing Specifics
Part 4: Architecture & Patterns
23. Component Composition Patterns
24. TypeScript Advanced Patterns
25. Error Boundaries & Suspense
26. Context API vs Redux Decision Tree
27. Memoization & Performance Decision Tree
28. Browser Storage Decision Tree
31. Advanced State Patterns
Part 5: Production Critical
10. Performance & Danger Zones
11. Accessibility (a11y)
12. Security
13. Testing Philosophy
14. Git & PR Workflow
33. Authentication & Authorization
34. API Integration Patterns
35. Error Handling Depth
36. Documentation Standards
Part 6: Advanced Features
29. React DevTools & Debugging
30. Core Web Vitals & Monitoring
38. Feature Flags & A/B Testing
39. Analytics & Event Tracking
40. Image & Asset Optimization
41. Mobile-Specific Patterns
42. Third-Party Library Evaluation
Part 7: Enterprise-Grade
43. Legacy Code Migration
44. Advanced Build Optimization
45. PWA & Service Workers
Reference
The Ultimate Quick Cheat Sheet



PART 0: MID-LEVEL DEVELOPER SURVIVAL GUIDE
These sections are your day-to-day survival kit. Read them before anything else.
47. Your First Week: Learning Path
Don't try to read everything at once. Follow this structured path.

📅 Day 1-2: Foundation
Section
Time
Why
1. Core Philosophy
5 min
Understand our mindset
5. Project Structure
10 min
Know where things live
9. Naming Conventions
15 min
Name things correctly from day one


📅 Day 3-4: Daily Development
Section
Time
Why
3. React Best Practices
20 min
Write React the right way
6. Writing Clean Methods
15 min
Write readable functions
21. Keeping JSX Clean
10 min
Don't pollute JSX with logic
📅 Week 2: Deep Dive
Section
Time
Why
4. State Management
30 min
Understand our state layer
15. Async/Error Handling
25 min
Handle async code properly
22. CSS & Styling
20 min
Style consistently
📅 Month 1: Advanced Topics
Read the remaining sections as you encounter them in your work. Don't memorize — reference.
48. Systematic Debugging Methodology
When you encounter a bug, follow this exact process. Don't skip steps.
Step 1: Reproduce Consistently
Can you make it happen every time?
What are the exact steps?
Document them (you'll need this for the PR fix)
Step 2: Isolate the Problem
Ask yourself:
Is it a UI issue? (CSS, rendering)
Is it a data issue? (API, state)
Is it a logic issue? (calculation, condition)
Use console.log strategically to narrow down.
Step 3: Check the Obvious First
Is the API returning the expected data? (Network tab)
Is the state what you think it is? (Redux DevTools)
Are there any console errors? (Console tab)
Did you forget to save the file? (Yes, it happens)
Step 4: Form a Hypothesis
Write down: "I think the issue is X because Y"
This prevents random changes
Step 5: Test Your Hypothesis
Make ONE change at a time
Verify the fix works
Check for side effects
If wrong, go back to Step 4
🚨 When to Ask for Help
You've spent >2 hours on the same bug
You've tried 3+ hypotheses and all failed
You don't understand the code you're debugging
You're stuck on Step 2 (can't isolate)
💡 Pro tip: Explain the problem out loud (rubber duck debugging). Often you'll find the answer while explaining it.
49. Navigating an Unfamiliar Codebase
📅 Day 1: High-Level Understanding
Read the README (if it exists)
Run the app locally — Click around, understand the user flow
Check package.json — What libraries are we using?
Look at the folder structure — Where are features located?
📅 Day 2: Trace a Feature
Pick one simple feature (e.g., "User Login")
Start from the entry point (route definition)
Follow the flow:
Route → Component → Hooks → API calls → State updates
Add console.logs to understand data flow
Draw a diagram on paper (seriously, it helps)
📅 Day 3: Make a Small Change
Fix a typo or small bug (builds confidence)
Ask questions — "I noticed X does Y, can you explain why?"


🎯 The "Cone of Understanding"
Week 1:  You understand 10% (the feature you're working on)
Week 2:  You understand 25% (related features)
Month 1: You understand 50% (most of the app)
Month 3: You understand 80% (you're productive)
Month 6: You understand 95% (you're the expert)

Don't panic if you don't understand everything immediately. Nobody does.
50. Breaking Down Large Tasks
❌ BAD Approach
Start coding immediately
Get overwhelmed after 2 hours
Create a massive PR (1000+ lines)
Request review, get blocked
✅ GOOD Approach
Example: "Build User Dashboard"
Step 1: Understand Requirements (30 min)
Read the ticket completely
Ask clarifying questions
Look at the design/mockup
Identify edge cases
Step 2: Break into Sub-tasks (1 hour)
User Dashboard
├── 1. Create page layout (2 hours)
│   ├── Header with user info
│   ├── Sidebar navigation
│   └── Main content area
├── 2. Fetch user data (3 hours)
│   ├── Create API endpoint call
│   ├── Add Redux slice
│   ├── Handle loading/error states
│   └── Write tests
├── 3. Build components (4 hours)
│   ├── UserProfileCard (1 hour)
│   ├── RecentActivityList (1.5 hours)
│   ├── StatsOverview (1.5 hours)
│   └── QuickActions (1 hour)
└── 4. Integration & polish (2 hours)
    ├── Connect components to data
    ├── Add loading skeletons
    ├── Handle empty states
    └── Responsive design


Step 3: Create Small PRs
PR 1: Page layout + routing (2 hours)
PR 2: API integration + Redux (3 hours)
PR 3: Individual components (4 hours)
PR 4: Integration + polish (2 hours)
Benefits:
Easier to review (100-200 lines per PR)
Faster feedback loop
Catches issues early
Less merge conflicts
51. Code Review: Giving & Receiving
Receiving Feedback (Your PR was reviewed)
Mindset: Feedback is about the code, not you. Every senior dev has had their code torn apart.
✅ GOOD Responses:
"Good catch! Fixed in abc123"
"I didn't think of that edge case. Updated."
"Can you explain why you suggest X? I want to understand."
"I disagree because [technical reason]. What do you think?"
❌ BAD Responses:
"But it works fine" (without explanation)
Silence (don't leave reviewers hanging)
Getting defensive
Making changes without explaining why
Process:
Read all comments first (don't react immediately)
Address every comment (even if just to say "won't fix because...")
Make changes in separate commits (easier to review)
Re-request review when done
Say "thanks" when merged
Giving Feedback (You're reviewing a PR)
✅ GOOD Comments:
"Nice use of custom hook here! Clean separation of concerns."
"Consider extracting this logic into a separate function for testability."
"Question: Why did you choose X over Y? Just curious."
"Nit: Could we use optional chaining here? user?.name"
❌ BAD Comments:
"This is wrong" (without explanation)
"Why didn't you do X?" (sounds accusatory)
Only commenting on style issues (let Prettier handle that)
Approving without reading
The 5 Types of Comments
[Must Fix] — Bugs, security issues, broken functionality
[Suggestion] — Better approach, but not blocking
[Nit] — Minor style preference, optional
[Question] — Just curious, no action needed
[Praise] — Something done well (don't forget these!)


52. Git Workflow: Practical Guide
Daily Workflow
# 1. Start your day - get latest changes
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feature/user-dashboard

# 3. Work on your feature
# ... make changes ...
git add .
git commit -m "feat: add user dashboard layout"

# 4. Push to remote
git push origin feature/user-dashboard

# 5. Create PR on GitHub/GitLab


Handling Merge Conflicts
# 1. Update your branch with latest main
git checkout feature/user-dashboard
git pull origin main

# 2. If conflicts occur, Git will tell you which files
# Open the files and look for:
// Your changes

# 3. Resolve conflicts manually
# - Keep your changes
# - Keep their changes
# - Or combine both
# - Remove the conflict markers (<<<<, ====, >>>>)

# 4. Stage resolved files
git add .

# 5. Complete the merge
git commit -m "merge: resolve conflicts with main"

# 6. Push
git push origin feature/user-dashboard


When to Rebase vs Merge
Rebase: When you want a clean, linear history (preferred for feature branches)
Merge: When you're combining branches that others are also working on
# Rebase your feature branch onto latest main
git checkout feature/user-dashboard
git rebase main

# If conflicts occur during rebase:
# 1. Resolve conflicts
# 2. git add .
# 3. git rebase --continue

# Force push (only for your own feature branches!)
git push --force-with-lease origin feature/user-dashboard


🚨 Git Safety Tips
Never force push to main/master
Always pull before pushing
Use --force-with-lease instead of --force (safer)
If you mess up, git reflog can save you (shows all your moves)
53. Task Estimation
The "T-Shirt Sizing" Method

Size
Time
Examples
XS
< 2 hours
Simple bug fix, text change, small UI tweak
S
2-4 hours
Single component, simple feature
M
4-8 hours
Feature with API integration, multiple components
L
1-2 days
Complex feature, multiple integrations
XL
3-5 days
Major feature, requires planning


Estimation Checklist
Before estimating, ask yourself:
Do I understand the requirements completely?
Have I built something similar before?
Are there any unknowns? (new library, unfamiliar code)
Do I need to write tests?
Do I need to update documentation?
Will this need code review iterations?
The "Multiply by Pi" Rule
If you're unsure, take your initial estimate and multiply by 3.14. Seriously. You're probably underestimating.
Breaking Down Estimates

Task: "Build User Dashboard" - Estimated: 3 days

Breakdown:
- Research & planning:     2 hours
- Page layout:             3 hours
- API integration:         4 hours
- Components (4x):         8 hours
- Testing:                 4 hours
- Code review iterations:  3 hours
- Bug fixes:               2 hours
- Documentation:           1 hour
Total: 27 hours ≈ 3.5 days

💡 Pro tip: Track your estimates vs actual time. After 10 tasks, you'll get much better at estimating.
54. When & How to Ask for Help
The 30-Minute Rule
Try to solve it yourself for 30 minutes before asking for help.
After 30 minutes, you should have:
Read the error message carefully
Googled the error
Checked Stack Overflow
Looked at similar code in the codebase
Tried at least 2 solutions
If you've done all that and still stuck, ask for help.
How to Ask Good Questions
❌ BAD Question:
"The dashboard isn't working. Can you help?"
✅ GOOD Question:
"I'm working on the user dashboard (ticket #123).
The API call to /api/users is returning a 401 error.
I've tried:
Checking if the token is being sent (it is, in the Authorization header)
Verifying the token is valid (it works in Postman)
Looking at the auth middleware (it checks for 'Bearer' prefix)
I think the issue might be with how we're attaching the token in the interceptor,
but I'm not sure. Can you take a look?
Here's the code: [link to file]
Here's the error: [screenshot]"
Who to Ask
Simple question (how does X work?): Ask a peer or check documentation
Technical issue (bug, implementation): Ask a senior dev on your team
Architecture decision (should we use X or Y?): Ask tech lead or in team meeting
Blocker (can't proceed): Ask immediately, don't wait
🚨 Red Flags: You Should Ask for Help NOW
You've been stuck for >2 hours
You don't understand the code you're supposed to modify
You're about to make a change that affects multiple features
You're unsure if your approach is correct
You feel overwhelmed or anxious
💡 Remember: Asking for help is a sign of maturity, not weakness. Senior devs respect devs who ask smart questions.
55. Writing Effective PR Descriptions
Template
markdown

## What does this PR do?
[Brief description of the changes]

## Why is this needed?
[Link to ticket, explain the business value]

## How to test this?
[Step-by-step instructions for the reviewer]

## Screenshots/Videos
[If UI changes, show before/after]

## Checklist
- [ ] Code follows our style guidelines
- [ ] I have added/updated tests
- [ ] I have updated documentation (if needed)
- [ ] This PR is < 400 lines (if not, explain why)
- [ ] I have tested this locally

Example
## What does this PR do?
Adds user dashboard page with profile info, recent activity, and quick actions.

## Why is this needed?
Ticket: https://jira.company.com/browse/PROJ-123
Users requested a centralized view of their account activity.

## How to test this?
1. Log in as any user
2. Navigate to `/dashboard`
3. Verify:
   - User profile card shows correct info
   - Recent activity list loads (should show 5 items)
   - Quick actions buttons work (Edit Profile, Change Password)
4. Test responsive design (resize browser)
5. Test loading state (throttle network to "Slow 3G")
6. Test error state (block API call in Network tab)

## Screenshots
[Before: No dashboard]
[After: Dashboard with all sections]

## Checklist
- [x] Code follows our style guidelines
- [x] I have added tests for API integration
- [x] This PR is 350 lines (split into 3 PRs)
- [x] Tested locally on Chrome, Firefox, Safari


PART 1: FOUNDATION & PHILOSOPHY
1. The Core Philosophy (The "Why")
Before we look at syntax, we must align on our mindset.
Explicit over Implicit: Don't make the reader guess. Name things clearly.
Composition over Inheritance: Build small, reusable pieces rather than massive, monolithic components.
Empathy for the Reader: Write code as if the person maintaining it is a violent psychopath who knows where you live. (Or, more gently, a junior dev who is stressed and on a tight deadline).
2. TypeScript & JavaScript Fundamentals
TypeScript is our safety net. Treat it with respect.
✅ The DOs
DO enable strict mode in tsconfig.json.
Why: It catches null/undefined errors and implicit any types at compile time, saving hours of runtime debugging.
DO use unknown instead of any when the type is truly unpredictable.
How: If you use unknown, TypeScript forces you to narrow the type (e.g., using type guards) before using it. any turns off TypeScript entirely.
DO define explicit return types for complex functions and all React components.
When: Always for components (React.FC or explicit JSX return). For functions, if the return type isn't immediately obvious from the name.
❌ The DON'Ts
DON'T use the any type.
Why: It defeats the entire purpose of TypeScript. If you are migrating and must use it, use @ts-expect-error with a comment explaining why, or use // TODO: fix type so it shows up in our tech debt tracker.
DON'T use Non-null assertion operator (!) excessively.
Why: It tells the compiler "trust me, this isn't null", which leads to runtime crashes if you are wrong. Use optional chaining (?.) or proper null checks instead.
3. React Best Practices
React is declarative. Let the framework do the heavy lifting.
✅ The DOs
DO extract complex logic into Custom Hooks.
How: If a component has more than 2 useEffects or complex state manipulation, move it to a use[Name].ts hook.
Why: It keeps UI components clean and makes logic reusable and testable.
DO use React.memo, useMemo, and useCallback intentionally.
When: Only when you have a measurable performance issue, or when passing functions/objects to heavily optimized child components.
Why: Premature optimization makes code harder to read. React is fast enough out of the box for 95% of use cases.
DO use descriptive keys for lists.
How: Use unique IDs from your database/API.
Why: Using array index as a key causes severe bugs when lists are reordered, filtered, or have items inserted/deleted.
❌ The DON'Ts
DON'T put business logic inside UI components.
Why: UI components should only care about rendering. If a button click triggers a complex API call and data transformation, that logic belongs in a hook or a service layer.
DON'T mutate state directly.
How: Never do state.push(item). Always do setState([...state, item]). (Redux enforces this, but it applies to local useState too).
4. State Management (Redux & Beyond)
State management is where apps go to die if done poorly. We use Redux Toolkit (RTK) for global client state.
✅ The DOs
DO use Redux Toolkit (RTK) exclusively.
How: Use createSlice and configureStore. RTK uses Immer under the hood, which allows you to write "mutating" logic in reducers that is safely converted to immutable updates.
Why: It eliminates 90% of the boilerplate of legacy Redux and prevents accidental state mutations.
DO separate Server State from Client State.
When: If data comes from an API and is just being displayed/cached, it's Server State. If it's UI toggles, form inputs, or complex client-side workflows, it's Client State.
Why: Storing API data in Redux often leads to complex caching logic.
❌ The DON'Ts
DON'T put everything in Redux.
Why: "Prop drilling" is annoying, but setting up Redux actions/reducers/selectors for a simple modal toggle is overkill. Use local useState or React Context for UI-only state.
DON'T put derived data in the Redux store.
How: If you have an array of users and an array of posts, don't store usersWithPosts in Redux. Calculate it on the fly using Reselect (memoized selectors).
Why: Storing derived data leads to synchronization bugs (e.g., the user updates, but the derived data doesn't).
5. Project Structure & Naming
Consistency reduces cognitive load.
Folder Structure (Feature-First)
Avoid grouping by technical role (e.g., putting all components in one folder, all hooks in another). Group by feature/domain.
text
src/
├── app/                # App entry, providers, root routing
├── features/           # 🌟 The core of the app
│   ├── auth/           # Auth feature
│   │   ├── components/ # UI specific to auth
│   │   ├── hooks/      # Hooks specific to auth
│   │   ├── api/        # RTK Query / API calls for auth
│   │   └── slice.ts    # Redux slice for auth
│   └── dashboard/      # Dashboard feature...
├── shared/             # Shared across features
│   ├── components/     # Generic UI (Buttons, Inputs)
│   ├── hooks/          # Generic hooks (useDebounce)
│   ├── utils/          # Pure helper functions
│   └── types/          # Global TS interfaces
└── store/              # Redux store configuration

Naming Conventions
Components: PascalCase (UserProfile.tsx)
Hooks: camelCase, starting with use (useAuth.ts)
Utils/Services: camelCase (formatDate.ts)
Constants: UPPER_SNAKE_CASE (MAX_RETRY_ATTEMPTS)
PART 2: WRITING CLEAN CODE
6. Writing Clean Methods & Functions
Functions are the building blocks of our logic. A good function should be easy to read, easy to test, and do exactly one thing.
✅ The DOs
DO use "Guard Clauses" (Early Returns) to reduce nesting.
typescript
// ❌ BAD: Deep nesting
const processUser = (user: User | null) => {
  if (user) {
    if (user.isActive) {
      return sendEmail(user);
    }
  }
};

// ✅ GOOD: Guard clauses
const processUser = (user: User | null) => {
  if (!user) return;
  if (!user.isActive) return;
  
  return sendEmail(user);
};

DO use an "Options Object" for functions with 3+ parameters.
// ❌ BAD
const fetchUsers = (page: number, limit: number, isActive?: boolean) => { ... }
fetchUsers(1, 10, undefined); // What is undefined?

// ✅ GOOD
interface FetchUsersOptions {
  page: number;
  limit: number;
  isActive?: boolean;
}
const fetchUsers = ({ page, limit, isActive }: FetchUsersOptions) => { ... }
fetchUsers({ page: 1, limit: 10 }); 


DO name functions using Verbs, and booleans using prefixes.
How: Use get, fetch, calculate, format for functions. Use is, has, can, should for booleans.
Examples: isLoading, hasPermission, formatCurrency, calculateTotal.
DO keep functions pure whenever possible.
What: A pure function always returns the same output for the same input and has no side effects.
❌ The DON'Ts
DON'T mutate function parameters.
DON'T write functions that do more than one conceptual thing.
How to check: If you have to use a comment like // --- Step 1: Validate --- and // --- Step 2: Save --- inside a function, those steps should probably be their own functions.

7. Code Styling & Syntax (The Micro-Level)
1. Variables & Constants
DO default to const. Only use let if you know the value will be reassigned. Never use var.
DON'T use magic numbers or strings. Extract them to constants or Enums.
2. Conditionals & Operators
DO use Nullish Coalescing (??) over Logical OR (||) for default values.
Why: || treats 0, "", and false as falsy. If you want a default for null or undefined only, use ??.
DO use Optional Chaining (?.) to prevent null reference errors.
DO use Ternary Operators (? :) ONLY for simple, single-line assignments.
3. Iteration & Arrays
DO use Array Methods (map, filter, reduce, find, some, every) over for loops.
Exception: Use a standard for...of loop only when you need to break or continue early.
DON'T use .forEach() if you are trying to transform data.
4. Destructuring & Spreading
DO destructure objects and arrays to extract exactly what you need.
8. The Great Debates
1. Interfaces: To I or not to I?
The Rule: DO NOT use the I prefix for interfaces. Use FetchUsersOptions, not IFetchUsersOptions.
Why: It's redundant, clutters the code, and goes against official TypeScript guidelines.
2. Arrow Functions vs. Function Declarations
The Rule: Use Function Declarations for React Components, and Arrow Functions for everything else.

// ✅ GOOD: React Component
export function UserProfile({ user }: Props) {
  return <div>{user.name}</div>;
}

// ✅ GOOD: Hooks, Utils, and inline callbacks
export const useAuth = () => { ... }
const calculateTotal = (items: Item[]) => { ... }
const handleClick = () => { ... }


3. Named Exports vs. Default Exports
The Rule: Use Named Exports for almost everything. Avoid Default Exports.
// ✅ GOOD: Named Export
export const Button = () => { ... }
// Importing: import { Button } from './Button';

// ❌ BAD: Default Export
const Button = () => { ... }
export default Button;


Why: Better refactoring, searchability, and works with barrel files.
9. Naming Conventions
The Ultimate Naming Cheat Sheet
What are you naming?
Convention
Example
❌ Bad Example
Variables / State
camelCase
userProfile, isLoading
user_profile, loading_flag
Booleans
camelCase + prefix
hasPermission, canEdit
permission, edit
Functions
camelCase + Verb
fetchUsers, formatDate
users, dateFormatter
Event Props
on + Verb
onClick, onSubmit
clickHandler, submit
Internal Handlers
handle + Noun/Verb
handleSubmit, handleClick
onClick, submitLogic
React Components
PascalCase
UserProfile, MainNav
userProfile, User-Profile
Component Files
PascalCase.tsx
UserProfile.tsx
user-profile.tsx
Logic/Util Files
camelCase.ts
useAuth.ts, formatDate.ts
UseAuth.ts, format-date.ts
Folders (Features)
kebab-case
user-profile/, auth/
userProfile/, User_Profile/
Constants
UPPER_SNAKE_CASE
MAX_RETRIES, API_URL
maxRetries, api_url
Types / Interfaces
PascalCase (No I)
User, AuthState
IUser, user_type
Enums / Lookups
PascalCase (Use as const)
UserRole.ADMIN
enum UserRole
20. Comments & Documentation
DO write comments that explain the "WHY", not the "WHAT".
// Good: Explains WHY
// We retry 3 times here because the payment gateway occasionally drops the first connection
const MAX_RETRIES = 3;

// Bad: Explains WHAT (the code already says this)
// Increment i by 1
i++;


DON'T leave commented-out code in PRs. Git remembers it forever.
DO use JSDoc for complex utility functions.
21. Keeping JSX Clean: Event Handlers & Inline Logic
The Anti-Pattern: "Fat" Inline Handlers

// ❌ BAD: The "Fat" Inline Handler
<button onClick={() => {
  if (!user.isActive) {
    toast.error('User is inactive');
    return;
  }
  dispatch(fetchUserDetails(user.id));
  analytics.track('user_details_viewed', { id: user.id });
  navigate(`/users/${user.id}`);
}}>
  View Details
</button>

The Rule: Extract to handle[Action]
// ✅ GOOD: Clean JSX, Extracted Logic
function UserCard({ user }) {
  const handleViewDetails = () => {
    if (!user.isActive) {
      toast.error('User is inactive');
      return;
    }
    dispatch(fetchUserDetails(user.id));
    analytics.track('user_details_viewed', { id: user.id });
    navigate(`/users/${user.id}`);
  };

  return (
    <div>
      <h2>{user.name}</h2>
      <button onClick={handleViewDetails}>View Details</button>
    </div>
  );
}


The Exception: Passing Arguments
// ✅ GOOD: Inline function used strictly to pass arguments
{users.map(user => (
  <li key={user.id}>
    <button onClick={() => handleDelete(user.id)}>Delete</button> 
  </li>
))}

The "One-Liner" Rule
// ✅ GOOD: Trivial one-liners can stay inline
<button onClick={() => setIsModalOpen(true)}>Open Modal</button>
PART 3: DAILY DEVELOPMENT PRACTICES
15. Async/Await & Error Handling (The Fetch Rules)
1. The Syntax: async/await vs .then().catch()
The Rule: ALWAYS use async/await with try/catch for complex logic.
// ❌ BAD: Hard to read, easy to miss the catch
fetchUser(id)
  .then(user => fetchPosts(user.id))
  .then(posts => dispatch(setPosts(posts)))
  .catch(err => console.error(err));

// ✅ GOOD: Clear flow, easy to isolate errors
const loadUserData = async (id: string) => {
  try {
    const user = await fetchUser(id);
    const posts = await fetchPosts(user.id);
    dispatch(setPosts(posts));
  } catch (error) {
    // Handle error
  }
}

2. The catch Block: Never Swallow the Error!
The Rule: A catch block must always do at least two things: Log/Track the error, and Notify the User/State.
3. The TypeScript Rule: catch (error: unknown)
try {
  await apiCall();
} catch (error: unknown) {
  if (error instanceof Error) {
    logger.captureException(error);
    toast.error(error.message);
  } else {
    logger.captureException(String(error));
  }
}

4. The Golden Pattern
export const fetchUserProfile = createAsyncThunk(
  'user/fetchProfile',
  async (userId: string, { rejectWithValue }) => {
    try {
      const response = await api.get(`/users/${userId}`);
      return response.data;
    } catch (error: unknown) {
      if (error instanceof Error) {
        Sentry.captureException(error);
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

16. Forms & Validation
DO use React Hook Form (RHF) for all forms.
Why: Native controlled inputs cause massive performance issues on large forms.
DO use Zod (or Yup) for schema validation.
Why: It provides TypeScript type inference for free.
DON'T validate only on submit.
Rule: Validate on onBlur or onChange (after the first error is shown).
17. Dates, Times, and Numbers
DO use a dedicated library for Date manipulation (date-fns or dayjs).
DO handle Timezones explicitly.
Rule: The backend should always send dates in UTC (ISO 8601 format).
DO use Intl.NumberFormat for currency and numbers.
new Intl.NumberFormat('en-US', { 
  style: 'currency', 
  currency: 'USD' 
}).format(1000);
18. Environment Variables & Secrets
DO prefix client-side environment variables correctly.
How: Vite → VITE_, Next.js → NEXT_PUBLIC_, CRA → REACT_APP_.
DON'T ever put secrets in client-side .env files.
DO provide a .env.example file.
19. Hardcoded Strings & Internationalization (i18n)
DON'T hardcode user-facing strings in JSX.
tsx
tsx
// ❌ BAD
<button>Submit</button>

// ✅ GOOD
<button>{t('common.submit')}</button>
DO use translation keys that describe the context, not just the English word.
Bad: t('submit')
Good: t('checkout_page.confirm_order_button')

22. CSS & Styling Architecture
🔑 Universal Principles (Applies to ALL Approaches)
DO use CSS Custom Properties (Variables) for Design Tokens.
DO follow Mobile-First Responsive Design.
DO ensure sufficient color contrast and visible focus states.
DON'T use !important to fix specificity wars.
DON'T use px for typography or spacing. Use rem.
🛠️ Approach-Specific Guidelines
1. Tailwind CSS
✅ DO: Extract repeated patterns into React components, not @apply blocks.
✅ DO: Use clsx or tailwind-merge for dynamic class composition.
❌ DON'T: Overuse arbitrary values (w-[317px]).
2. CSS Modules
✅ DO: Co-locate Component.module.css next to Component.tsx.
✅ DO: Use camelCase for class exports.
3. CSS-in-JS (Styled Components / Emotion)
✅ DO: Use for highly dynamic, prop-driven styling.
❌ DON'T: Create a new styled component inside the render function.
tsx
// ❌ BAD
const Component = () => {
  const Box = styled.div`...`; // Re-created every render!
  return <Box />;
}

// ✅ GOOD: Define outside the component
const Box = styled.div`...`;
export const Component = () => <Box />;

4. SCSS / Plain CSS
✅ DO: Limit nesting to a maximum of 3 levels.
✅ DO: Use BEM naming: .card, .card__title, .card--featured.
⚡ Performance & Animation
DO animate only transform and opacity.
DON'T animate width, height, top, left, or margin.
DO respect prefers-reduced-motion:
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}

37. Testing Specifics
1. Test Structure (Arrange-Act-Assert)
describe('UserProfile', () => {
  it('displays user name when data loads successfully', async () => {
    // Arrange
    const mockUser = userFactory.build({ name: 'John Doe' });
    server.use(rest.get('/api/users/1', (req, res, ctx) => 
      res(ctx.json(mockUser))
    ));
    
    // Act
    render(<UserProfile userId="1" />);
    
    // Assert
    expect(await screen.findByText('John Doe')).toBeInTheDocument();
  });
});


2. Test Data Factories
import { Factory } from 'fishery';

export const userFactory = Factory.define<User>(({ sequence }) => ({
  id: `user-${sequence}`,
  name: `User ${sequence}`,
  email: `user${sequence}@example.com`,
  role: 'user',
  createdAt: new Date().toISOString(),
}));

// Usage
const adminUser = userFactory.build({ role: 'admin' });
const multipleUsers = userFactory.buildList(5);

3. What NOT to Test
// ❌ BAD: Testing implementation details
it('calls setState with correct value', () => {
  const setState = jest.fn();
  jest.spyOn(React, 'useState').mockReturnValue([false, setState]);
  render(<Toggle />);
  fireEvent.click(screen.getByRole('button'));
  expect(setState).toHaveBeenCalledWith(true); // Don't test this!
});

// ✅ GOOD: Test behavior instead
it('toggles visibility when button is clicked', () => {
  render(<Toggle />);
  expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Hidden content')).toBeInTheDocument();
});

PART 4: ARCHITECTURE & PATTERNS
23. Component Composition Patterns
1. Compound Components

function Tabs({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState(0);
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
}

Tabs.Tab = function Tab({ index, children }: { index: number; children: React.ReactNode }) {
  const { activeTab, setActiveTab } = useTabsContext();
  return (
    <button 
      className={activeTab === index ? 'active' : ''}
      onClick={() => setActiveTab(index)}
    >
      {children}
    </button>
  );
};

// Usage
<Tabs>
  <Tabs.Tab index={0}>Profile</Tabs.Tab>
  <Tabs.Tab index={1}>Settings</Tabs.Tab>
</Tabs>


2. Custom Hooks (The Modern Alternative)
When to use: Almost always prefer custom hooks over render props for sharing logic.
📝 Pattern Decision Tree
Need to share state between components?
├─ YES → Compound Components
└─ NO → Need to share logic?
    ├─ YES → Custom Hooks (preferred)
    │   └─ Need to control rendering? → Render Props
    └─ NO → Simple Children Composition

    24. TypeScript Advanced Patterns
1. Utility Types Mastery

// Partial<T> - Make all properties optional
type UpdateUser = Partial<User>;

// Pick<T, K> - Pick specific properties
type UserPreview = Pick<User, 'id' | 'name'>;

// Omit<T, K> - Omit specific properties
type UserWithoutEmail = Omit<User, 'email'>;

// Record<K, T> - Object with specific key/value types
type UserRoles = Record<string, 'admin' | 'user' | 'guest'>;

// Exclude<T, U> - Exclude types from union
type ActiveStatus = Exclude<Status, 'inactive'>;

2. Type Guards & Narrowing
function isDog(animal: Dog | Cat): animal is Dog {
  return 'breed' in animal;
}

function handleAnimal(animal: Dog | Cat) {
  if (isDog(animal)) {
    animal.bark(); // TypeScript knows it's a Dog
  } else {
    animal.meow(); // TypeScript knows it's a Cat
  }
}

3. Generic Components
interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyExtractor: (item: T) => string;
}

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return (
    <ul>
      {items.map(item => (
        <li key={keyExtractor(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}

4. Discriminated Unions
type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

function UserDisplay({ state }: { state: AsyncState<User> }) {
  switch (state.status) {
    case 'idle': return <div>Ready to load</div>;
    case 'loading': return <Spinner />;
    case 'success': return <div>{state.data.name}</div>;
    case 'error': return <div>Error: {state.error.message}</div>;
  }
}

25. Error Boundaries & Suspense
1. Error Boundaries

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.captureException(error, { extra: errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div>Something went wrong</div>;
    }
    return this.props.children;
  }
}

✅ DO: Wrap independent sections in separate Error Boundaries.
❌ DON'T: Wrap the entire app in one Error Boundary.
2. Combining Error Boundaries + Suspense
<Suspense fallback={<Skeleton />}>
  <ErrorBoundary fallback={<ErrorFallback />}>
    <Dashboard />
  </ErrorBoundary>
</Suspense>
26. Context API vs Redux Decision Tree
Scenario
Use
Why
UI state (modals, dropdowns)
useState / useReducer
Local to component
Shared UI state (theme, auth)
Context API
Simple, built-in
Complex client state (cart, forms)
Redux Toolkit
Predictable, debuggable
Server state (API data)
React Query / RTK Query
Caching, background refetch
High-frequency updates
Zustand / Redux
Context causes re-renders
⚠️ Context API Pitfalls
❌ DON'T use Context for everything. Context causes ALL consumers to re-render when the value changes.
✅ DO: Split Context into multiple smaller contexts, or use useMemo to stabilize the value.

27. Memoization & Performance Decision Tree
Scenario
Memoize?
Why
Expensive calculations
✅ useMemo
Avoid recalculating
Functions passed to memoized children
✅ useCallback
Prevent child re-renders
Simple calculations
❌ No
Overhead > cost
Functions passed to non-memoized children
❌ No
Wasted
Event handlers in JSX
❌ No
React handles efficiently

🚨 The Golden Rule
Don't memoize until you have a measurable performance problem.
28. Browser Storage Decision Tree
Storage
Capacity
Persistence
Use Case
localStorage
~5-10 MB
Until cleared
User preferences
sessionStorage
~5-10 MB
Until tab closes
Temporary form data
Cookies
~4 KB
Configurable
Auth tokens (httpOnly)
IndexedDB
Unlimited*
Until cleared
Large datasets
Memory (Redux)
Limited by RAM
Until reload
Sensitive tokens
⚠️ Security Rules
❌ NEVER store sensitive tokens in localStorage. XSS attacks can steal it.
✅ DO: Use httpOnly cookies for auth tokens.
31. Advanced State Patterns
1. State Machines (XState)
When to use: Complex multi-step flows (checkout, onboarding, video player).
2. Optimistic Updates
tsx
const handleLike = async (postId: string) => {
  dispatch(optimisticLike(postId));
  try {
    await api.post(`/posts/${postId}/like`);
    dispatch(confirmLike(postId));
  } catch (error) {
    dispatch(rollbackLike(postId));
    toast.error('Failed to like post');
  }
};
3. Debouncing & Throttling
// Debouncing: Wait until user stops typing
const debouncedSearch = useDebouncedCallback((value) => {
  dispatch(searchUsers(value));
}, 500);

// Throttling: Execute at most once per X ms
const throttledScroll = useThrottledCallback((position) => {
  analytics.track('scroll', { position });
}, 1000);

PART 5: PRODUCTION CRITICAL
10. Performance & Danger Zones
✅ The DOs
DO respect the useEffect dependency array.
Rule: Never disable the react-hooks/exhaustive-deps ESLint rule.
DO use Code Splitting and Lazy Loading.
DO handle "Empty", "Loading", and "Error" states for ALL data fetching.
❌ The DON'Ts
DON'T render massive lists without Virtualization.
When: If you are rendering more than 100-200 DOM nodes.
How: Use react-window or @tanstack/virtual.
11. Accessibility (a11y)
DO use Semantic HTML before anything else.
How: Use <button> for actions, <a> for navigation. Don't use <div onClick={...}>.
DO ensure all interactive elements are keyboard accessible.
DO provide alt text for images.
DON'T use ARIA attributes to fix bad HTML.
12. Security
DON'T ever use dangerouslySetInnerHTML unless the HTML is strictly sanitized.
DON'T store highly sensitive tokens in localStorage.
DO validate data on the frontend, but NEVER trust it.
13. Testing Philosophy
DO test Behavior, not Implementation Details.
DO write Unit Tests for Utils and Hooks.
DON'T test third-party libraries.
14. Git & PR Workflow
DO keep Pull Requests small and focused (< 400-500 lines).
DO write descriptive PR descriptions.
DO use Conventional Commits.
How: feat:, fix:, chore:, docs:, refactor:
DON'T argue about syntax in PRs.
33. Authentication & Authorization Patterns
1. JWT Token Management
tsx
class TokenManager {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string> | null = null;

  async getValidAccessToken(): Promise<string> {
    if (!this.isTokenExpired(this.accessToken)) {
      return this.accessToken!;
    }
    if (this.refreshPromise) return this.refreshPromise;
    
    this.refreshPromise = this.refreshAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
}

❌ DON'T: Store refresh tokens in localStorage.
✅ DO: Use httpOnly cookies (set by backend).
2. Protected Routes
function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (requiredRole && !user.roles.includes(requiredRole)) return <ForbiddenPage />;

  return <>{children}</>;
}
3. Permission-Based UI
function RequirePermission({ permission, children, fallback = null }: Props) {
  const { user } = useAuth();
  if (!user?.permissions.includes(permission)) return <>{fallback}</>;
  return <>{children}</>;
}

// Usage
<RequirePermission permission="user:delete" fallback={null}>
  <Button variant="danger" onClick={handleDelete}>Delete User</Button>
</RequirePermission>

34. API Integration Patterns
1. API Client Setup with Interceptors

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 15000,
});

// Request interceptor - attach auth token
apiClient.interceptors.request.use(async (config) => {
  const token = await tokenManager.getValidAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor - handle 401 globally
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      await refreshToken();
      return apiClient.request(error.config);
    }
    return Promise.reject(error);
  }
);

2. Request Deduplication
class RequestDeduplicator {
  private pendingRequests = new Map<string, Promise<any>>();

  async deduplicate<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key) as Promise<T>;
    }
    const promise = requestFn().finally(() => {
      this.pendingRequests.delete(key);
    });
    this.pendingRequests.set(key, promise);
    return promise;
  }
}

35. Error Handling Depth
1. Error Categorization
class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public userMessage?: string
  ) {
    super(message);
  }
}

class NetworkError extends AppError {
  constructor(message = 'Network error') {
    super(message, 'NETWORK_ERROR', undefined, 'Please check your internet connection');
  }
}

class ValidationError extends AppError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR', 400, message);
  }
}
2. User-Facing Error Messages
const ERROR_MESSAGES: Record<string, string> = {
  'EMAIL_ALREADY_EXISTS': 'This email is already registered. Please use a different email or log in.',
  'INVALID_CREDENTIALS': 'Invalid email or password. Please try again.',
  'PASSWORD_TOO_WEAK': 'Password must be at least 8 characters...',
};

function getUserFriendlyError(error: AppError): string {
  if (error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code];
  if (error.userMessage) return error.userMessage;
  return 'An unexpected error occurred. Please try again.';
}

3. Retry with Exponential Backoff
async function fetchWithRetry<T>(
  requestFn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}
36. Documentation Standards
1. README Structure
Include: Quick Start, Prerequisites, Project Structure, Testing, Deployment, Documentation links, Contributing.
2. Architecture Decision Records (ADRs)
Document important decisions with: Status, Context, Decision, Consequences (Positive/Negative), References.
3. Code Comments Philosophy
tsx
// ❌ BAD: Comments that explain WHAT
if (user.role === 'admin') {
  return <AdminPanel />;
}

// ✅ GOOD: Comments that explain WHY
// Admin users bypass the two-factor authentication requirement
// because they have already been verified through the SSO integration
if (user.role === 'admin') {
  return <AdminPanel />;
}

PART 6: ADVANCED FEATURES
29. React DevTools & Debugging
1. React DevTools Profiler
Open React DevTools → Profiler tab
Click "Record"
Perform the slow interaction
Analyze the flamegraph
Look for long bars and frequent re-renders
2. Chrome DevTools Performance Tab
Long tasks (red triangles) = JavaScript blocking the main thread
Layout shifts = Elements moving around
Scripting time = Too much JavaScript execution
3. Network Tab Debugging
Request waterfall = Are requests happening in parallel or serial?
Response sizes = Are you downloading too much data?
Caching = Are static assets being cached correctly?
30. Core Web Vitals & Monitoring
📊 The Three Core Metrics
Metric
What It Measures
Good
Poor
LCP (Largest Contentful Paint)
Loading performance
< 2.5s
> 4s
FID (First Input Delay)
Interactivity
< 100ms
> 300ms
CLS (Cumulative Layout Shift)
Visual stability
< 0.1
> 0.25
✅ How to Improve Each Metric
LCP (Loading):
Optimize images (WebP, lazy loading)
Preload critical resources
Reduce JavaScript bundle size
Use a CDN
FID (Interactivity):
Break up long JavaScript tasks
Defer non-critical JavaScript
CLS (Visual Stability):
Always set width and height on images/videos
Avoid inserting content above existing content
Use CSS transform for animations
38. Feature Flags & A/B Testing
1. Feature Flag Implementation
tsx
interface FeatureFlags {
  newCheckoutFlow: boolean;
  darkMode: boolean;
  experimentalSearch: boolean;
}

function FeatureFlag({ flag, children, fallback = null }: FeatureFlagProps) {
  const isEnabled = useFeatureFlag(flag);
  if (!isEnabled) return <>{fallback}</>;
  return <>{children}</>;
}

// Usage
<FeatureFlag flag="experimentalSearch" fallback={<LegacySearch />}>
  <NewSearchWithAI />
</FeatureFlag>

2. A/B Testing
tsx
function useABTest(testId: string): string {
  const [variant] = useState<string>(() => {
    const stored = localStorage.getItem(`ab-test-${testId}`);
    if (stored) return stored;
    // Assign variant based on weights
    // Track assignment
    return assignedVariant;
  });
  return variant;
}

39. Analytics & Event Tracking
1. Analytics Abstraction Layer
tsx
class AnalyticsService {
  private providers: AnalyticsProvider[] = [];

  track(name: string, properties?: Record<string, any>) {
    const event: AnalyticsEvent = { name, properties };
    this.providers.forEach(provider => {
      try { provider.track(event); } 
      catch (error) { console.error('Analytics tracking failed', error); }
    });
  }
}

export const analytics = new AnalyticsService();
2. Event Naming Conventions
tsx
// ✅ Format: object_action or object_state
analytics.track('button_clicked', { buttonName: 'signup' });
analytics.track('form_submitted', { formName: 'contact' });
analytics.track('user_logged_in', { method: 'google' });
analytics.track('checkout_completed', { orderId: '12345', revenue: 99.99 });

// ❌ BAD
analytics.track('clicked button'); // Too vague
analytics.track('signupButtonClicked'); // Inconsistent
40. Image & Asset Optimization
1. Responsive Images
tsx
<img
  src="/images/hero-800w.webp"
  srcSet="
    /images/hero-400w.webp 400w,
    /images/hero-800w.webp 800w,
    /images/hero-1200w.webp 1200w
  "
  sizes="(max-width: 600px) 400px, (max-width: 1200px) 800px, 1200px"
  alt="Hero image description"
  loading="lazy"
  width="1200"
  height="600"
/>

2. Font Loading Strategy
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />

css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter-var.woff2') format('woff2');
  font-display: swap; /* Prevents FOIT */
}

41. Mobile-Specific Patterns
1. Safe Area Insets (Notch Handling)
:root {
  --sat: env(safe-area-inset-top);
  --sab: env(safe-area-inset-bottom);
}

.bottom-nav {
  padding-bottom: var(--sab);
}

html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />

2. Touch-Friendly Button Sizes
<button style={{ minWidth: '44px', minHeight: '44px' }}>Click Me</button>

tsx
<button style={{ minWidth: '44px', minHeight: '44px' }}>Click Me</button>
3. Prevent iOS Zoom on Input Focus
input, select, textarea {
  font-size: 16px; /* Prevents iOS zoom on focus */
}

42. Third-Party Library Evaluation
Library Evaluation Checklist
Last updated within 6 months?
Active maintainers?
TypeScript support?
Test coverage (>80%)?
Works with our React version?
Tree-shakeable?
No known vulnerabilities (npm audit)?
Bundle size impact acceptable?
Bundle Size Analysis
# Check before installing
# https://bundlephobia.com/package/[package-name]

# Use bundle analyzer
npm install -D rollup-plugin-visualizer

PART 7: ENTERPRISE-GRADE
43. Legacy Code Migration
1. Strangler Fig Pattern
// Use feature flag to gradually replace
function UserList() {
  const useNewList = useFeatureFlag('newUserList');
  if (useNewList) return <NewUserList />;
  return <LegacyUserList />;
}

2. Incremental TypeScript Migration
// Step 1: Add @ts-check to top of file
// @ts-check

// Step 2: Use JSDoc for gradual typing
/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 */

// Step 3: Rename to .tsx and add proper types

3. Class → Functional Component Migration
// ❌ OLD: Class component
class UserCard extends React.Component {
  state = { isExpanded: false };
  handleToggle = () => this.setState({ isExpanded: !this.state.isExpanded });
  render() { /* ... */ }
}

// ✅ NEW: Functional component with hooks
function UserCard({ user }: { user: User }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const handleToggle = () => setIsExpanded(!isExpanded);
  return ( /* ... */ );
}

44. Advanced Build Optimization
1. Code Splitting
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./pages/Dashboard'));

function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </Suspense>
  );
}

2. Tree Shaking
// ✅ GOOD: Use named imports (tree-shakeable)
import { debounce, throttle } from 'lodash-es';

// ❌ BAD: Default import (not tree-shakeable)
import _ from 'lodash';
_.debounce(fn, 100);

3. Preloading & Prefetching
<Link 
  to="/dashboard" 
  onMouseEnter={() => import('./pages/Dashboard')}
>
  Dashboard
</Link>

45. PWA & Service Workers
1. Service Worker Registration
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('New version available. Reload?')) updateSW();
  },
  onOfflineReady() {
    toast.success('App ready to work offline');
  },
});

2. Offline Detection
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

📋 The Ultimate Quick Cheat Sheet
Category
✅ DO THIS
❌ DON'T DO THIS
Types
Use unknown and narrow it
Use any or @ts-ignore
Interfaces
Name it FetchUsersOptions
Name it IFetchUsersOptions
Components
Use function ComponentName() {}
Use const ComponentName = () => {}
Hooks/Utils
Use const myHook = () => {}
Use function myHook() {}
Exports
Use Named Exports
Use Default Exports
React
Extract logic to Custom Hooks
Write 300-line functional components
React
Use id for list keys
Use array index for list keys
Redux
Use RTK createSlice
Write manual switch-case reducers
Redux
Store raw data, derive the rest
Store calculated data in Redux
State
Use useState for UI toggles
Put a modal's isOpen in Redux
Functions
Use Guard Clauses
Write deeply nested if/else
Functions
Use Options Object for 3+ params
Pass 5 positional arguments
Syntax
Use ?? for null/undefined defaults
Use `
Syntax
Use ?. for optional chaining
Write obj && obj.prop && obj.prop.val
Arrays
Use .map(), .filter(), .find()
Use .forEach() to create a new array
Async
Use async/await + try/catch
Write deep .then().then().catch()
Catch
Log to Sentry + Show UI feedback
Just console.error() and swallow
JSX
Extract logic to handle[Action]
Write 15 lines of logic in onClick
Naming
isLoading, hasPermission
loading, permission
Naming
handleSubmit, handleClick
onClick, submitLogic
Units
Use rem for layout/typography
Use px for text/spacing
Animations
transform & opacity
width, top, margin
A11y
:focus-visible styles
Removing outline without replacement
Styling
Let Prettier format the code
Argue about spaces/quotes in PRs
Debugging
Follow 5-step methodology
Make random changes
PRs
Keep < 400 lines
Create 1000-line PRs
Help
Ask after 30 min of trying
Stay stuck for 2+ hours silently
