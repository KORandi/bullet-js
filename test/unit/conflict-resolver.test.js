/**
 * Conflict Resolver unit tests
 */

const { expect } = require('chai');
const ConflictResolver = require('../../src/sync/conflict-resolver');
const VectorClock = require('../../src/sync/vector-clock');

describe('ConflictResolver', () => {
  describe('Constructor', () => {
    it('should use default strategy when no options provided', () => {
      const resolver = new ConflictResolver();
      expect(resolver.defaultStrategy).to.equal('last-write-wins');
      expect(resolver.pathStrategies).to.deep.equal({});
      expect(resolver.customResolvers).to.deep.equal({});
    });
    
    it('should initialize with provided options', () => {
      const options = {
        defaultStrategy: 'merge-fields',
        pathStrategies: { users: 'merge-fields', settings: 'first-write-wins' },
        customResolvers: { inventory: () => {} }
      };
      
      const resolver = new ConflictResolver(options);
      
      expect(resolver.defaultStrategy).to.equal('merge-fields');
      expect(resolver.pathStrategies).to.deep.equal(options.pathStrategies);
      expect(resolver.customResolvers).to.have.property('inventory');
    });
  });
  
  describe('getStrategyForPath()', () => {
    it('should return strategy for exact path match', () => {
      const resolver = new ConflictResolver({
        defaultStrategy: 'last-write-wins',
        pathStrategies: { 'users/user1': 'merge-fields' }
      });
      
      expect(resolver.getStrategyForPath('users/user1')).to.equal('merge-fields');
    });
    
    it('should return strategy for parent path', () => {
      const resolver = new ConflictResolver({
        defaultStrategy: 'last-write-wins',
        pathStrategies: { 'users': 'merge-fields' }
      });
      
      expect(resolver.getStrategyForPath('users/user1')).to.equal('merge-fields');
    });
    
    it('should return default strategy when no match found', () => {
      const resolver = new ConflictResolver({
        defaultStrategy: 'last-write-wins',
        pathStrategies: { 'users': 'merge-fields' }
      });
      
      expect(resolver.getStrategyForPath('products/laptop')).to.equal('last-write-wins');
    });
    
    it('should match most specific path when multiple matches exist', () => {
      const resolver = new ConflictResolver({
        defaultStrategy: 'last-write-wins',
        pathStrategies: { 
          'users': 'merge-fields',
          'users/admin': 'first-write-wins'
        }
      });
      
      expect(resolver.getStrategyForPath('users/admin/profile')).to.equal('first-write-wins');
    });
  });
  
  describe('resolve()', () => {
    // Helper to create test data
    const createTestData = (value, timestamp, vectorClock = {}) => ({
      value,
      timestamp,
      vectorClock: vectorClock instanceof VectorClock ? vectorClock : new VectorClock(vectorClock)
    });
    
    describe('last-write-wins strategy', () => {
      it('should select data with newer timestamp', () => {
        const resolver = new ConflictResolver({
          defaultStrategy: 'last-write-wins'
        });
        
        const localData = createTestData({ name: 'Product A', price: 100 }, 1000);
        const remoteData = createTestData({ name: 'Product A', price: 120 }, 2000);
        
        const result = resolver.resolve('products/item', localData, remoteData);
        expect(result.value).to.deep.equal({ name: 'Product A', price: 120 });
      });
      
      it('should select local data when timestamps are equal', () => {
        const resolver = new ConflictResolver({
          defaultStrategy: 'last-write-wins'
        });
        
        const localData = createTestData({ name: 'Product A', price: 100 }, 1000);
        const remoteData = createTestData({ name: 'Product A', price: 120 }, 1000);
        
        const result = resolver.resolve('products/item', localData, remoteData);
        expect(result.value).to.deep.equal({ name: 'Product A', price: 100 });
      });
    });
    
    describe('first-write-wins strategy', () => {
      it('should select data with older timestamp', () => {
        const resolver = new ConflictResolver({
          defaultStrategy: 'first-write-wins'
        });
        
        const localData = createTestData({ apiKey: 'new-key' }, 2000);
        const remoteData = createTestData({ apiKey: 'original-key' }, 1000);
        
        const result = resolver.resolve('settings/global', localData, remoteData);
        expect(result.value).to.deep.equal({ apiKey: 'original-key' });
      });
    });
    
    describe('merge-fields strategy', () => {
      it('should merge fields from both objects', () => {
        const resolver = new ConflictResolver({
          defaultStrategy: 'merge-fields'
        });
        
        const localData = createTestData(
          { name: 'Alice', email: 'alice@example.com' },
          1000
        );
        
        const remoteData = createTestData(
          { name: 'Alice', phone: '555-1234' }, 
          2000
        );
        
        const result = resolver.resolve('users/alice', localData, remoteData);
        
        expect(result.value).to.deep.equal({
          name: 'Alice',
          email: 'alice@example.com',
          phone: '555-1234'
        });
      });
      
      it('should fall back to last-write-wins for non-object values', () => {
        const resolver = new ConflictResolver({
          defaultStrategy: 'merge-fields'
        });
        
        const localData = createTestData('Local value', 1000);
        const remoteData = createTestData('Remote value', 2000);
        
        const result = resolver.resolve('simple/value', localData, remoteData);
        expect(result.value).to.equal('Remote value');
      });
    });
    
    describe('custom strategy', () => {
      it('should apply custom resolver function', () => {
        // Custom resolver that takes minimum stock value
        const customResolver = (path, localData, remoteData) => {
          if (localData.value && remoteData.value &&
              typeof localData.value.stock === 'number' &&
              typeof remoteData.value.stock === 'number') {
            
            const result = localData.timestamp >= remoteData.timestamp ? 
              { ...localData } : { ...remoteData };
              
            const minStock = Math.min(localData.value.stock, remoteData.value.stock);
            result.value = { ...result.value, stock: minStock };
            
            return result;
          }
          
          return localData.timestamp >= remoteData.timestamp ? localData : remoteData;
        };
        
        const resolver = new ConflictResolver({
          defaultStrategy: 'last-write-wins'
        });
        
        resolver.registerCustomResolver('inventory', customResolver);
        
        const localData = createTestData({ name: 'Widget', stock: 100 }, 1000);
        const remoteData = createTestData({ name: 'Widget', stock: 75, onSale: true }, 2000);
        
        const result = resolver.resolve('inventory/widget', localData, remoteData);
        
        expect(result.value).to.deep.equal({
          name: 'Widget',
          stock: 75,
          onSale: true
        });
      });
      
      it('should fall back to last-write-wins if no custom resolver found', () => {
        const resolver = new ConflictResolver({
          defaultStrategy: 'last-write-wins',
          pathStrategies: { 'products': 'custom' }
        });
        
        const localData = createTestData({ name: 'Product A' }, 1000);
        const remoteData = createTestData({ name: 'Product B' }, 2000);
        
        const result = resolver.resolve('products/item', localData, remoteData);
        expect(result.value).to.deep.equal({ name: 'Product B' });
      });
    });
    
    describe('deletion handling', () => {
      it('should handle local deletion with newer timestamp', () => {
        const resolver = new ConflictResolver();
        
        const localData = createTestData(null, 2000);
        const remoteData = createTestData({ name: 'Product' }, 1000);
        
        const result = resolver.resolve('products/item', localData, remoteData);
        expect(result.value).to.be.null;
      });
      
      it('should handle remote deletion with newer timestamp', () => {
        const resolver = new ConflictResolver();
        
        const localData = createTestData({ name: 'Product' }, 1000);
        const remoteData = createTestData(null, 2000);
        
        const result = resolver.resolve('products/item', localData, remoteData);
        expect(result.value).to.be.null;
      });
      
      it('should handle both sides deleted', () => {
        const resolver = new ConflictResolver();
        
        const localData = createTestData(null, 1000);
        const remoteData = createTestData(null, 2000);
        
        const result = resolver.resolve('products/item', localData, remoteData);
        expect(result.value).to.be.null;
      });
      
      it('should respect timestamp for deletion vs update conflict', () => {
        const resolver = new ConflictResolver();
        
        const localData = createTestData({ name: 'Product', updated: true }, 2000);
        const remoteData = createTestData(null, 1000);
        
        const result = resolver.resolve('products/item', localData, remoteData);
        expect(result.value).to.deep.equal({ name: 'Product', updated: true });
      });
    });
  });
  
  describe('setStrategy() and registerCustomResolver()', () => {
    it('should set strategy for a path', () => {
      const resolver = new ConflictResolver();
      
      resolver.setStrategy('users', 'merge-fields');
      resolver.setStrategy('settings', 'first-write-wins');
      
      expect(resolver.getStrategyForPath('users/user1')).to.equal('merge-fields');
      expect(resolver.getStrategyForPath('settings/theme')).to.equal('first-write-wins');
    });
    
    it('should register a custom resolver for a path', () => {
      const resolver = new ConflictResolver();
      const customFn = () => {};
      
      resolver.registerCustomResolver('inventory', customFn);
      
      expect(resolver.customResolvers.inventory).to.equal(customFn);
      expect(resolver.pathStrategies.inventory).to.equal('custom');
    });
  });
});
