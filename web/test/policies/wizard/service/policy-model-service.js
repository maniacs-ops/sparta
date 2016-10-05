describe('policies.wizard.service.policy-model-service', function () {
  beforeEach(module('webApp'));
  beforeEach(module('model/policy.json'));
  beforeEach(module('model/transformation.json'));

  var service, q, rootScope, httpBackend, translate, ModalServiceMock, PolicyModelFactoryMock, ModelFactoryMock, CubeServiceMock,
    UtilsServiceMock,wizardStatusServiceMock, resolvedPromiseFunction,  fakeModel, fakePolicy = null;

  resolvedPromiseFunction = function () {
    var defer = $q.defer();
    defer.resolve();
    return defer.promise;
  };

  beforeEach(module(function ($provide) {
    wizardStatusServiceMock = jasmine.createSpyObj('WizardStatusService', ['enableNextStep', 'disableNextStep']);
    ModalServiceMock = jasmine.createSpyObj('ModalService', ['openModal']);
    PolicyModelFactoryMock = jasmine.createSpyObj('PolicyModelFactory', ['getCurrentPolicy', 'enableNextStep', 'disableNextStep']);
    ModelFactoryMock = jasmine.createSpyObj('ModelFactory', ['getModel', 'isValidModel', 'resetModel', 'getContext', 'isAutoGeneratedDateTime']);
    CubeServiceMock = jasmine.createSpyObj('CubeService', ['findCubesUsingOutputs']);
    UtilsServiceMock = jasmine.createSpyObj('UtilsService', ['removeItemsFromArray']);

    PolicyModelFactoryMock.getCurrentPolicy.and.returnValue(fakePolicy);

    // inject mocks
    $provide.value('WizardStatusService', wizardStatusServiceMock);
    $provide.value('ModalService', ModalServiceMock);
    $provide.value('PolicyModelFactory', PolicyModelFactoryMock);
    $provide.value('ModelFactory', ModelFactoryMock);
    $provide.value('CubeService', CubeServiceMock);
    $provide.value('UtilsService', UtilsServiceMock);
  }));

  beforeEach(inject(function (_modelTransformation_, _modelPolicy_, _ModelService_, $q, $rootScope, $httpBackend, $translate) {
    fakeModel = _modelTransformation_;
    fakePolicy =  angular.copy(_modelPolicy_);

    service = _ModelService_;
    translate = $translate;
    q = $q;
    httpBackend = $httpBackend;
    rootScope = $rootScope;

    // mocked responses
    ModalServiceMock.openModal.and.callFake(function () {
      var defer = $q.defer();
      defer.resolve();
      return {"result": defer.promise};
    });

    $httpBackend.when('GET', 'languages/en-US.json')
      .respond({});

    ModelFactoryMock.getModel.and.returnValue(fakeModel);
    ModelFactoryMock.getContext.and.returnValue({"position": 0});

    spyOn(translate, "instant").and.callThrough();
  }));


  describe("should be able to show a confirmation modal with the cubes names introduced as param when model is going to be removed", function () {
    var fakeCubeNames = ["fake cube 1", "fake cube 2", "fake cube 3"];
    var expectedModalResolve = {
      title: function () {
        return "_REMOVE_MODEL_CONFIRM_TITLE_"
      },
      message: "_REMOVE_MODEL_MESSAGE_"
    };

    beforeEach(function () {
      translate.instant.calls.reset();
    });

    afterEach(function () {
      rootScope.$digest();
    });

    it("modal should render the confirm modal template", function () {
      service.showConfirmRemoveModel().then(function () {
        expect(ModalServiceMock.openModal.calls.mostRecent().args[1]).toBe('templates/modal/confirm-modal.tpl.html');
      });
    });

    it("if cube name list is empty, message displayed is empty", function () {
      service.showConfirmRemoveModel().then(function () {
        expect(ModalServiceMock.openModal.calls.mostRecent().args[2].title()).toEqual(expectedModalResolve.title());
        expect(ModalServiceMock.openModal.calls.mostRecent().args[2].message()).toEqual("");
        expect(translate.instant).not.toHaveBeenCalled();
      });
    });

    it("if cube name list is not empty, message is displayed with the cube names separated by comma", function () {
      service.showConfirmRemoveModel(fakeCubeNames).then(function () {
        expect(ModalServiceMock.openModal.calls.mostRecent().args[2].title()).toEqual(expectedModalResolve.title());
        expect(ModalServiceMock.openModal.calls.mostRecent().args[2].message()).toEqual(expectedModalResolve.message);
        expect(translate.instant).toHaveBeenCalledWith('_REMOVE_MODEL_MESSAGE_', {modelList: fakeCubeNames.toString()});
      });
    });

  });

  describe("should be able to add a model to the policy", function () {

    it("model is not added if it is not valid", function () {
      ModelFactoryMock.isValidModel.and.returnValue(false);
      service.addModel();
      expect(service.policy.transformations.length).toBe(0);
    });

    describe("if model is valid", function () {
      beforeEach(function () {
        ModelFactoryMock.isValidModel.and.returnValue(true);
        ModelFactoryMock.isAutoGeneratedDateTime.and.returnValue(false);
        service.addModel();
      });

      it("it is added to policy with its order", function () {
        expect(service.policy.transformations.length).toBe(1);
        expect(service.policy.transformations[0].name).toEqual(fakeModel.name);
        expect(service.policy.transformations[0].order).toEqual(fakeModel.order);
      });
    });
  });

  describe("should be able to remove the model of the factory", function () {
    var cubeMockWithModelOutput, fakeFoundCubes = null;

    beforeEach(inject(function ($rootScope) {
      cubeMockWithModelOutput = {
        "dimensions": [{"field": fakeModel.outputFields[0]}, {"field": "any"}]
      };
      var cubeMockWithoutModelOutput = {
        "dimensions": [{"field": "any"}, {"field": "another"}]
      };
      service.policy.transformations = [fakeModel];
      rootScope = $rootScope;
      service.policy.cubes = [cubeMockWithoutModelOutput, cubeMockWithModelOutput];

      fakeFoundCubes = {
        names: [service.policy.cubes[1].field],
        positions: [1]
      };
      CubeServiceMock.findCubesUsingOutputs.and.returnValue(fakeFoundCubes);
    }));

    afterEach(function () {
      rootScope.$apply();
    });

    it("should  remove all found cubes which use the outputs of the model", function () {
      spyOn(service, "showConfirmRemoveModel").and.callFake(resolvedPromiseFunction);
      var cubesBefore = angular.copy(service.policy.cubes);
      service.removeModel().then(function () {
        expect(service.policy.transformations.length).toBe(0);
        expect(UtilsServiceMock.removeItemsFromArray).toHaveBeenCalledWith(cubesBefore, fakeFoundCubes.positions);
      });
    });
  });
  it("should be able to return if a model is the last model in the model array by its position", function () {
    service.policy.transformations = [];
    service.policy.transformations.push(fakeModel);
    service.policy.transformations.push(fakeModel);
    service.policy.transformations.push(fakeModel);

    expect(service.isLastModel(0)).toBeFalsy();
    expect(service.isLastModel(1)).toBeFalsy();
    expect(service.isLastModel(2)).toBeTruthy();
  });

  it("should be able to return if a model is a new model by its position", function () {
    service.policy.transformations = [];
    service.policy.transformations.push(fakeModel);
    service.policy.transformations.push(fakeModel);
    service.policy.transformations.push(fakeModel);

    expect(service.isNewModel(0)).toBeFalsy();
    expect(service.isNewModel(2)).toBeFalsy();
    expect(service.isNewModel(3)).toBeTruthy();
  });


  describe("should be able to activate the panel to create a new model", function () {
    var modelLength = null;
    beforeEach(function () {
      modelLength = fakePolicy.transformations.length;
      service.activateModelCreationPanel();
    });

    it("visibility of model creation panel is changed to true", function () {
      expect(service.isActiveModelCreationPanel()).toBe(true);
    });
  });
});
