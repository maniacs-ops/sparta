/*
 * Copyright (C) 2015 Stratio (http://stratio.com)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.stratio.sparta.serving.api.actor

import akka.actor.{Actor, ActorRef}
import com.stratio.sparta.serving.api.actor.LauncherActor._
import com.stratio.sparta.serving.api.utils.{ClusterCheckerUtils, SparkSubmitUtils}
import com.stratio.sparta.serving.core.actor.StatusActor.{ResponseStatus, Update}
import com.stratio.sparta.serving.core.config.SpartaConfig
import com.stratio.sparta.serving.core.constants.AppConstant._
import com.stratio.sparta.serving.core.models.enumerators.PolicyStatusEnum._
import com.stratio.sparta.serving.core.models.policy.{PhaseEnum, PolicyErrorModel, PolicyModel, PolicyStatusModel}
import com.stratio.sparta.serving.core.utils.{ClusterListenerUtils, SchedulerUtils}
import org.apache.spark.launcher.{SparkAppHandle, SparkLauncher}

import scala.util.{Failure, Success, Try}

class ClusterLauncherActor(val statusActor: ActorRef) extends Actor
  with SchedulerUtils with SparkSubmitUtils with ClusterListenerUtils with ClusterCheckerUtils {

  override def receive: PartialFunction[Any, Unit] = {
    case Start(policy: PolicyModel) => doInitSpartaContext(policy)
    case ResponseStatus(status) => loggingResponsePolicyStatus(status)
    case _ => log.info("Unrecognized message in Cluster Launcher Actor")
  }

  def doInitSpartaContext(policy: PolicyModel): Unit = {
    Try {
      log.info(s"Initializing cluster submit from policy: ${policy.name}")
      val zookeeperConfig = SpartaConfig.getZookeeperConfig.getOrElse {
        val message = "Impossible to extract Zookeeper Configuration"
        log.error(message)
        throw new RuntimeException(message)
      }
      val execMode = executionMode(policy)
      val clusterConfig = SpartaConfig.getClusterConfig(Option(execMode)).get
      validateSparkHome(clusterConfig)
      val sparkHome = extractSparkHome(clusterConfig)
      val driverFile = extractDriverSubmit(policy, DetailConfig, SpartaConfig.getHdfsConfig)
      val master = clusterConfig.getString(Master).trim
      val pluginsFiles = pluginsJars(policy)
      val driverArguments =
        extractDriverArguments(policy, driverFile, clusterConfig, zookeeperConfig, execMode, pluginsFiles)
      val (sparkSubmitArguments, sparkConfigurations) =
        extractSubmitArgumentsAndSparkConf(policy, clusterConfig, pluginsFiles)

      log.info(s"Launching Sparta Job with options ... \n\tPolicy name: ${policy.name}\n\t" +
        s"Main: $SpartaDriverClass\n\tDriver file: $driverFile\n\tMaster: $master\n\t" +
        s"Spark submit arguments: ${sparkSubmitArguments.mkString(",")}\n\t" +
        s"Spark configurations: ${sparkConfigurations.mkString(",")}\n\tDriver arguments: $driverArguments\n\t" +
        s"Plugins files: ${pluginsFiles.mkString(",")}")

      (launch(policy, SpartaDriverClass, driverFile, master, sparkSubmitArguments, sparkConfigurations,
        driverArguments, sparkHome), clusterConfig)
    } match {
      case Failure(exception) =>
        val information = s"Error when launching the Sparta cluster job"
        log.error(information, exception)
        statusActor ! Update(PolicyStatusModel(id = policy.id.get, status = Failed, statusInfo = Option(information),
          lastError = Option(PolicyErrorModel(information, PhaseEnum.Execution, exception.toString))
        ))
      case Success((sparkHandler, clusterConfig)) =>
        val information = "Sparta cluster job launched correctly"
        log.info(information)
        statusActor ! Update(PolicyStatusModel(id = policy.id.get, status = Launched,
          submissionId = Option(sparkHandler.getAppId), submissionStatus = Option(sparkHandler.getState.name()),
          statusInfo = Option(information), lastExecutionMode = Option(getDetailExecutionMode(policy, clusterConfig))
        ))
        if (isCluster(policy, clusterConfig)) addClusterContextListener(policy.id.get, policy.name, clusterConfig)
        else addClientContextListener(policy.id.get, policy.name, clusterConfig, sparkHandler)
        scheduleOneTask(AwaitPolicyChangeStatus, DefaultAwaitPolicyChangeStatus)(checkPolicyStatus(policy))
    }
  }

  def launch(policy: PolicyModel,
             main: String,
             driverFile: String,
             master: String,
             sparkArguments: Map[String, String],
             sparkConfigurations: Map[String, String],
             driverArguments: Seq[String],
             sparkHome: String
            ): SparkAppHandle = {
    val sparkLauncher = new SparkLauncher()
      .setSparkHome(sparkHome)
      .setAppResource(driverFile)
      .setMainClass(main)
      .setMaster(master)

    //Spark arguments
    sparkArguments.filter(_._2.nonEmpty).foreach { case (k: String, v: String) => sparkLauncher.addSparkArg(k, v) }
    sparkArguments.filter(_._2.isEmpty).foreach { case (k: String, v: String) => sparkLauncher.addSparkArg(k) }

    // Spark properties
    sparkConfigurations.filter(_._2.nonEmpty)
      .foreach { case (key: String, value: String) => sparkLauncher.setConf(key.trim, value.trim) }

    // Driver (Sparta) params
    driverArguments.foreach(sparkLauncher.addAppArgs(_))

    // Launch SparkApp
    sparkLauncher.startApplication(addSparkListener(policy))
  }
}