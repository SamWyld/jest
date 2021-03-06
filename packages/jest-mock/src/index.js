/**
 * Copyright (c) 2014-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 */

'use strict';

type Mock = any;
type MockFunctionMetadata = {
  ref?: any,
  members?: Object,
  mockImpl?: () => any,
  name?: string,
  refID?: string|number,
  type?: string,
  value?: any,
};

const MOCK_CONSTRUCTOR_NAME = 'mockConstructor';

// $FlowFixMe
const RESERVED_KEYWORDS = Object.assign(Object.create(null), {
  do: true,
  if: true,
  in: true,
  for: true,
  let: true,
  new: true,
  try: true,
  var: true,
  case: true,
  else: true,
  enum: true,
  eval: true,
  null: true,
  this: true,
  true: true,
  void: true,
  with: true,
  await: true,
  break: true,
  catch: true,
  class: true,
  const: true,
  false: true,
  super: true,
  throw: true,
  while: true,
  yield: true,
  delete: true,
  export: true,
  import: true,
  public: true,
  return: true,
  static: true,
  switch: true,
  typeof: true,
  default: true,
  extends: true,
  finally: true,
  package: true,
  private: true,
  continue: true,
  debugger: true,
  function: true,
  arguments: true,
  interface: true,
  protected: true,
  implements: true,
  instanceof: true,
});

function isA(typeName: string, value: any): boolean {
  return Object.prototype.toString.apply(value) === '[object ' + typeName + ']';
}

function getType(ref?: any): string|null {
  if (isA('Function', ref)) {
    return 'function';
  } else if (Array.isArray(ref)) {
    return 'array';
  } else if (isA('Object', ref)) {
    return 'object';
  } else if (isA('Number', ref) || isA('String', ref) || isA('Boolean', ref)) {
    return 'constant';
  } else if (isA('Map', ref) || isA('WeakMap', ref) || isA('Set', ref)) {
    return 'collection';
  } else if (isA('RegExp', ref)) {
    return 'regexp';
  } else if (ref === undefined) {
    return 'undefined';
  } else if (ref === null) {
    return 'null';
  } else {
    return null;
  }
}

function isReadonlyProp(object: any, prop: string): boolean {
  return (
    (
      (
        prop === 'arguments' ||
        prop === 'caller' ||
        prop === 'callee' ||
        prop === 'name' ||
        prop === 'length'
      ) &&
      isA('Function', object)
    ) ||
    (
      (
        prop === 'source' ||
        prop === 'global' ||
        prop === 'ignoreCase' ||
        prop === 'multiline'
      ) &&
      isA('RegExp', object)
    )
  );
}

function getSlots(object?: Object): Array<string> {
  const slots = {};
  if (!object) {
    return [];
  }

  let parent = Object.getPrototypeOf(object);
  do {
    if (object === Object.getPrototypeOf(Function)) {
      break;
    }
    const ownNames = Object.getOwnPropertyNames(object);
    for (let i = 0; i < ownNames.length; i++) {
      const prop = ownNames[i];
      if (!isReadonlyProp(object, prop)) {
        const propDesc = Object.getOwnPropertyDescriptor(object, prop);
        if (!propDesc.get || object.__esModule) {
          slots[prop] = true;
        }
      }
    }
    object = parent;
  } while (object && (parent = Object.getPrototypeOf(object)) !== null);
  return Object.keys(slots);
}

function createMockFunction(
  metadata: MockFunctionMetadata,
  mockConstructor: () => any,
): any {
  let name = metadata.name;
  // Special case functions named `mockConstructor` to guard for infinite loops.
  if (!name || name === MOCK_CONSTRUCTOR_NAME) {
    return mockConstructor;
  }

  // Preserve `name` property of mocked function.
  const boundFunctionPrefix = 'bound ';
  let bindCall = '';
  // if-do-while for perf reasons. The common case is for the if to fail.
  if (name && name.startsWith(boundFunctionPrefix)) {
    do {
      name = name.substring(boundFunctionPrefix.length);
      // Call bind() just to alter the function name.
      bindCall = '.bind(null)';
    } while (name && name.startsWith(boundFunctionPrefix));
  }

  // It's a syntax error to define functions with a reserved keyword
  // as name.
  if (RESERVED_KEYWORDS[name]) {
    name = '$' + name;
  }

  // It's also a syntax error to define a function with a reserved character
  // as part of it's name.
  if (/[\s-]/.test(name)) {
    name = name.replace(/[\s-]/g, '$');
  }

  /* eslint-disable no-new-func */
  return new Function(
    MOCK_CONSTRUCTOR_NAME,
    'return function ' + name + '() {' +
      'return ' + MOCK_CONSTRUCTOR_NAME + '.apply(this,arguments);' +
    '}' + bindCall,
  )(mockConstructor);
  /* eslint-enable no-new-func */
}

function makeComponent(metadata: MockFunctionMetadata): Mock {
  if (metadata.type === 'object') {
    return {};
  } else if (metadata.type === 'array') {
    return [];
  } else if (metadata.type === 'regexp') {
    return new RegExp('');
  } else if (
    metadata.type === 'constant' ||
    metadata.type === 'collection' ||
    metadata.type === 'null' ||
    metadata.type === 'undefined'
  ) {
    return metadata.value;
  } else if (metadata.type === 'function') {
    let isReturnValueLastSet = false;
    let defaultReturnValue;
    let mockImpl;
    /* eslint-disable prefer-const */
    let f;
    /* eslint-enable perfer-const */
    const specificReturnValues = [];
    const specificMockImpls = [];
    const calls = [];
    const instances = [];
    const prototype = (
      metadata.members &&
      metadata.members.prototype &&
      metadata.members.prototype.members
    ) || {};
    const prototypeSlots = getSlots(prototype);
    const mockConstructor = function() {
      instances.push(this);
      calls.push(Array.prototype.slice.call(arguments));
      if (this instanceof f) {
        // This is probably being called as a constructor
        prototypeSlots.forEach(slot => {
          // Copy prototype methods to the instance to make
          // it easier to interact with mock instance call and
          // return values
          if (prototype[slot].type === 'function') {
            const protoImpl = this[slot];
            this[slot] = generateFromMetadata(prototype[slot]);
            this[slot]._protoImpl = protoImpl;
          }
        });

        // Run the mock constructor implementation
        return mockImpl && mockImpl.apply(this, arguments);
      }

      let returnValue;
      // If return value is last set, either specific or default, i.e.
      // mockReturnValueOnce()/mockReturnValue() is called and no
      // mockImplementationOnce()/mockImplementation() is called after that.
      // use the set return value.
      if (isReturnValueLastSet) {
        returnValue = specificReturnValues.shift();
        if (returnValue === undefined) {
          returnValue = defaultReturnValue;
        }
      }

      // If mockImplementationOnce()/mockImplementation() is last set,
      // or specific return values are used up, use the mock implementation.
      let specificMockImpl;
      if (returnValue === undefined) {
        specificMockImpl = specificMockImpls.shift();
        if (specificMockImpl === undefined) {
          specificMockImpl = mockImpl;
        }
        if (specificMockImpl) {
          return specificMockImpl.apply(this, arguments);
        }
      }

      // Otherwise use prototype implementation
      if (returnValue === undefined && f._protoImpl) {
        return f._protoImpl.apply(this, arguments);
      }

      return returnValue;
    };

    f = createMockFunction(metadata, mockConstructor);
    f._isMockFunction = true;
    f.getMockImplementation = () => mockImpl;
    f.mock = {calls, instances};

    f.mockClear = () => {
      calls.length = 0;
      instances.length = 0;
    };

    f.mockReturnValueOnce = value => {
      // next function call will return this value or default return value
      isReturnValueLastSet = true;
      specificReturnValues.push(value);
      return f;
    };

    f.mockReturnValue = value => {
      // next function call will return specified return value or this one
      isReturnValueLastSet = true;
      defaultReturnValue = value;
      return f;
    };

    f.mockImplementationOnce = fn => {
      // next function call will use this mock implementation return value
      // or default mock implementation return value
      isReturnValueLastSet = false;
      specificMockImpls.push(fn);
      return f;
    };

    f.mockImplementation = f.mockImpl = fn => {
      // next function call will use mock implementation return value
      isReturnValueLastSet = false;
      mockImpl = fn;
      return f;
    };

    f.mockReturnThis = () =>
      f.mockImplementation(function() {
        return this;
      });

    if (metadata.mockImpl) {
      f.mockImplementation(metadata.mockImpl);
    }

    return f;
  } else {
    const unknownType = metadata.type || 'undefined type';
    throw new Error('Unrecognized type ' + unknownType);
  }
}

function generateMock(
  metadata: MockFunctionMetadata,
  callbacks: Array<() => any>,
  refs: Object,
): Mock {
  const mock = makeComponent(metadata);
  if (metadata.refID != null) {
    refs[metadata.refID] = mock;
  }

  getSlots(metadata.members).forEach(slot => {
    const slotMetadata = metadata.members && metadata.members[slot] || {};
    if (slotMetadata.ref != null) {
      callbacks.push(() => mock[slot] = refs[slotMetadata.ref]);
    } else {
      mock[slot] = generateMock(slotMetadata, callbacks, refs);
    }
  });

  if (
    metadata.type !== 'undefined' &&
    metadata.type !== 'null' &&
    mock.prototype
  ) {
    mock.prototype.constructor = mock;
  }

  return mock;
}

function generateFromMetadata(_metadata: MockFunctionMetadata): Mock {
  const callbacks = [];
  const refs = {};
  const mock = generateMock(_metadata, callbacks, refs);
  callbacks.forEach(setter => setter());
  return mock;
}

function getMetadata(
  component: any,
  _refs?: Map<any, any>,
): ?MockFunctionMetadata {
  const refs = _refs || new Map();
  const ref = refs.get(component);
  if (ref != null) {
    return {ref};
  }

  const type = getType(component);
  if (!type) {
    return null;
  }

  const metadata: MockFunctionMetadata = {type};
  if (
    type === 'constant' ||
    type === 'collection' ||
    type === 'undefined' ||
    type === 'null'
  ) {
    metadata.value = component;
    return metadata;
  } else if (type === 'function') {
    metadata.name = component.name;
    if (component._isMockFunction) {
      metadata.mockImpl = component.getMockImplementation();
    }
  }

  metadata.refID = refs.size;
  refs.set(component, metadata.refID);

  let members = null;
  // Leave arrays alone
  if (type !== 'array') {
    if (type !== 'undefined') {
      getSlots(component).forEach(slot => {
        if (
          type === 'function' &&
          component._isMockFunction &&
          slot.match(/^mock/)
        ) {
          return;
        }

        if (
          (!component.hasOwnProperty && component[slot] !== undefined) ||
          (component.hasOwnProperty && component.hasOwnProperty(slot)) ||
          (type === 'object' && component[slot] != Object.prototype[slot])
        ) {
          const slotMetadata = getMetadata(component[slot], refs);
          if (slotMetadata) {
            if (!members) {
              members = {};
            }
            members[slot] = slotMetadata;
          }
        }
      });
    }

    // If component is native code function, prototype might be undefined
    if (type === 'function' && component.prototype) {
      const prototype = getMetadata(component.prototype, refs);
      if (prototype && prototype.members) {
        if (!members) {
          members = {};
        }
        members.prototype = prototype;
      }
    }
  }

  if (members) {
    metadata.members = members;
  }

  return metadata;
}

function isMockFunction(fn: any): boolean {
  return !!fn._isMockFunction;
}

module.exports = {
  /**
   * @see README.md
   * @param metadata Metadata for the mock in the schema returned by the
   * getMetadata method of this module.
   */
  generateFromMetadata,

  /**
   * @see README.md
   * @param component The component for which to retrieve metadata.
   */
  getMetadata,

  /**
   * @see README.md
   */
  getMockFunction(): () => any {
    return makeComponent({type: 'function'});
  },

  // Just a short-hand alias
  getMockFn(): () => any {
    return this.getMockFunction();
  },

  isMockFunction,
};
