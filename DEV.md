# Information for Library Developers

This documentation is for developers of the Feedme WebSocket transport.

<!-- TOC depthFrom:2 -->

- [Getting Started](#getting-started)
- [Directory Structure](#directory-structure)
- [Source Modules](#source-modules)
  - [Source Files](#source-files)
- [Target Node and NPM Versions](#target-node-and-npm-versions)
- [NPM Scripts](#npm-scripts)
- [Development and Deployment Workflow](#development-and-deployment-workflow)

<!-- /TOC -->

## Getting Started

To get started:

```shell
git clone https://github.com/aarong/feedme-transport-ws
cd feedme-transport-ws
npm install
```

Edit the source code in the `src` folder and run linting and unit tests:

```shell
npm run test-src
# or
npm run test-src -- --watch
```

Build a publish-ready NPM package in the `build` folder, including a browser
bundle:

```shell
npm run build
```

When the build process has completed, functional tests are automatically run on
the Node module in `build`. Those tests can also be run explicitly:

```shell
npm run test-build-node
```

Functional tests in targeted browsers require Sauce credentials in the
`SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environmental variables. Then do:

```shell
npm run test-build-browsers
```

Jasmine recognizes source maps in Node, but unfortunately not in the browser.

To enable debugging output set the `debug` environment variable to
`feedme-transport-ws:client` or `feedme-transport-ws:server`.

## Directory Structure

- `build/`

  Created by `npm run build`. Contains files ready to be deployed as an NPM
  package. Includes an entrypoint for Node (`index.js`) and a UMD module for
  browsers (`browser.bundle.js` has no sourcemaps and is used by applications,
  while `browser.bundle.withmaps.js` has sourcemaps and is used for testing and
  debugging).

  LICENSE, README.md, and package.json are included.

  (Gulp/Browserify)

- `coverage/`

  Created by `npm run coverage`. Coverage information for unit tests only.

  (Jest)

- `docs/`

  Created by `npm run docs`. Source code documentation.

  (Documentation.js)

- `src/`

  Module source code. Linted ES6.

- `src/__tests__`

  Unit tests

  (Jest)

- `tests/`

  Functional tests for the Node and and browser builds.

  Node tests are written in ES6 and browser tests in ES5.

## Source Modules

Module source code is written in ES6 and is transpiled on build for Node and the
browser.

Eslint enforces Airbnb style and applies Prettier (which takes precence over
some Airbnb rules). A lint check is performed before unit tests.

Errors are thrown, called back, and emitted in the form
`new Error("ERROR_CODE: Some more descriptive text.")`. Altering the `name`
property of an error object breaks sourcemaps in the browser.

### Source Files

- `browser.js` is the entrypoint for the browser client. Injects whichever
  `WebSocket` implementation is available into the `browser.main.js` module.

- `browser.main.js` is the browser client module. The browser client codebase is
  maintained separately from the Node client because the latter has greater
  functionality (ping/pong functionality, more modern JS API, etc). The
  WebSocket constructor is injected for easier unit testing.

- `client.config.js` contains hard-coded configuration for the browser and Node
  clients, mainly default options.

- `client.js` is the entrypoint for the Node client. Injects `ws` into the
  `client.main.js` module.

- `client.main.js` is the Node client module. The Node client codebase is
  maintained separately from the browser client because the former has greater
  functionality. The WebSocket constructor is injected for easier unit testing.

- `index.js` provides a common entrypoint for the browser client, Node client,
  and Node server modules.

- `server.config.js` contains hard-coded configuration for the Node server,
  mainly default options.

- `server.js` is the entrypoint for the Node server. Injects `ws` into the
  `server.main.js` module.

- `server.main.js` is the Node server module. The WebSocket constructor is
  injected for easier unit testing.

## Target Node and NPM Versions

The intention is to support Node and NPM back as far as realistically possible.

For a development install, the binding dependency constraint is that Eslint
requires Node 6+, but package-lock.json is only supported by NPM 5+, which comes
with Node 8+. Develop on Node 8+ and NPM 5+ to ensure that the repo has
package-lock.json, and rely on Travis to test on Node 6. The Node 6 build is
published to NPM, as it should be compatible with later versions of Node.

Since production installs run code transpiled for Node 6, there is no guarantee
that they will support earlier versions of Node even though there are far fewer
dependency-related version constraints.

## NPM Scripts

- `npm run docs` Generate source code documentation in `docs`.

- `npm run lint-src` Check for linting errors in `src`.

- `npm run lint-build-tests` Check for linting errors in `tests`.

- `npm run coverage` Display Jest unit test coverage.

- `npm run coveralls` Used by Travis to pass coverage information to Coveralls.

- `npm run test-src` Run linting and Jest unit tests on the source code. Aliased
  by `npm run test`.

- `npm run build` Run the unit tests, build a publishable NPM package in
  `build`, and run the Node functional tests on the build. Browser tests must be
  run explicitly, given the need for Sauce credentials.

- `npm run test-build-node` Run functional tests against the Node module in the
  `build` folder.

- `npm run test-build-browsers` Run functional tests against the browser bundle
  in the `build` folder on Sauce Labs. Requires the environmental variables
  `SAUCE_USERNAME` and `SAUCE_ACCESS_KEY`.

  Due to the way that the Sauce Connect Proxy works, connecting via WebSocket to
  `localhost` fails in various modern browsers (1006 error). The work-around is
  to use the hosts file to redirect another domain to `localhost`, and then have
  the VM browsers connect to that domain. As a result, in order to run the Sauce
  tests, you need to have `testinghost.com` redirected to `localhost` in your
  local hosts file before running the tests. The Sauce Connect Proxy will route
  all VM browser requests to your PC, look up `testinghost.com` in your local
  hosts file, and route WebSocket connections accordingly.

  To run browser tests in a local browser rather than on Sauce, do
  `npm run test-build-browsers -- local` and then open `http://localhost:3000`
  in your browser.

## Development and Deployment Workflow

Contributors can fork the repo, make changes, and submit a pull request.

Significant new features should be developed in feature branches.

```shell
# Fork and clone the repo locally
git checkout -b my-new-feature
# Make changes
git commit -m "Added my new feature."
git push origin my-new-feature
# Submit a pull request
```

Commits to the master branch are built and tested by Travis CI. If the NPM
package version has been incremented, then Travis will deploy by publishing the
build to NPM.
